-- =============================================================
-- Agenda Mel — 038: o horário só vale depois que ela aceita
--
-- Até aqui o bot marcava direto: a cliente escolhia e o horário
-- nascia confirmado. Está errado para quem atende. Quem decide se vai
-- atender é a profissional, e ela pode estar com a agenda cheia por
-- fora, doente, ou simplesmente não querer aquele encaixe.
--
-- Agora o bot cria um PEDIDO. A profissional recebe no WhatsApp e
-- responde 1 para aceitar, 2 para recusar. A cliente é avisada nos dois
-- casos. E o prazo é dela: cada profissional configura quanto tempo tem
-- para responder, e o que acontece se o prazo passar.
--
-- O horário fica RESERVADO enquanto o pedido está aberto — ele já é uma
-- linha em appointments com status 'pendente', então some da lista de
-- vagas e ninguém pega por baixo. Se for recusado ou expirar com
-- 'cancela', volta a ficar livre.
-- =============================================================

-- 1. A configuração de cada profissional ---------------------------------
alter table public.professionals
  add column if not exists aceite_manual boolean not null default true;

alter table public.professionals
  add column if not exists minutos_para_aceitar integer not null default 120;

-- o que fazer com o silêncio dela. 'confirma' é o padrão: a vaga estava
-- livre, a cliente pediu, e sumir com o horário por causa de uma
-- profissional distraída é perder a cliente por erro nosso.
alter table public.professionals
  add column if not exists ao_expirar text not null default 'confirma';

do $$ begin
  alter table public.professionals
    add constraint prazo_de_aceite_razoavel
    check (minutos_para_aceitar between 5 and 2880);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.professionals
    add constraint ao_expirar_conhecido
    check (ao_expirar in ('confirma', 'cancela'));
exception when duplicate_object then null; end $$;

grant update (aceite_manual, minutos_para_aceitar, ao_expirar)
  on public.professionals to authenticated;

-- 2. Os pedidos abertos ---------------------------------------------------
create table if not exists public.aceites (
  appointment_id uuid primary key
    references public.appointments (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  -- guardados aqui porque é por eles que a resposta chega, e o cadastro
  -- pode mudar entre o pedido e a resposta
  telefone_prof text not null,
  telefone_cliente text not null,
  pedido_em timestamptz not null default now(),
  expira_em timestamptz not null,
  resolvido_em timestamptz,
  -- aceito | recusado | expirou
  resultado text
);

create index if not exists aceites_abertos_idx
  on public.aceites (expira_em) where resultado is null;
create index if not exists aceites_prof_idx
  on public.aceites (telefone_prof) where resultado is null;

alter table public.aceites enable row level security;

drop policy if exists "equipe ve os pedidos" on public.aceites;
create policy "equipe ve os pedidos"
  on public.aceites for select
  to authenticated
  using (public.is_admin_do_salao(salon_id)
         or public.is_professional(professional_id));

revoke insert, update, delete on public.aceites from authenticated, anon;

-- 3. Textos ---------------------------------------------------------------
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('pedido_de_aceite',   true, 'utilidade', null),
  ('pedido_aceito',      true, 'utilidade', null),
  ('pedido_recusado',    true, 'utilidade', null)
on conflict (kind) do nothing;
update public.whatsapp_regras set envia = true
where kind in ('pedido_de_aceite', 'pedido_aceito', 'pedido_recusado');

-- 4. Abrir o pedido -------------------------------------------------------
create or replace function public.pedir_aceite(appt uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  p public.professionals%rowtype;
  tel_prof text;
  tel_cli text;
  nome_cli text;
  quando text;
  prazo timestamptz;
begin
  select * into a from public.appointments where id = appt;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sem agendamento'); end if;

  select * into p from public.professionals where id = a.professional_id;
  if not found or not p.aceite_manual then
    return jsonb_build_object('ok', false, 'motivo', 'aceite desligado');
  end if;

  select public.telefone_e164(pf.phone) into tel_prof
  from public.profiles pf where pf.id = p.user_id;

  select public.telefone_e164(pf.phone), nullif(btrim(pf.full_name), '')
    into tel_cli, nome_cli
  from public.profiles pf where pf.id = a.client_id;

  -- Sem telefone dela não há como perguntar, e deixar o pedido pendurado
  -- esperando uma resposta que nunca vem é pior do que confirmar.
  if tel_prof is null then
    return jsonb_build_object('ok', false, 'motivo', 'profissional sem telefone');
  end if;

  prazo := now() + make_interval(mins => p.minutos_para_aceitar);
  quando := public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI');

  insert into public.aceites
    (appointment_id, professional_id, salon_id, telefone_prof, telefone_cliente, expira_em)
  values (appt, p.id, a.salon_id, tel_prof, coalesce(tel_cli, ''), prazo)
  on conflict (appointment_id) do nothing;

  perform public.notificar(
    p.user_id, 'pedido_de_aceite', 'Pedido de horário',
    coalesce(nome_cli, 'Uma cliente') || ' quer ' ||
      coalesce(a.service_name, 'um atendimento') || ' ' || quando,
    '/pro',
    jsonb_build_object('appointment_id', appt, 'professional_id', p.id));

  return jsonb_build_object('ok', true, 'expira_em', prazo,
                            'minutos', p.minutos_para_aceitar);
end;
$$;

revoke execute on function public.pedir_aceite(uuid)
  from public, anon, authenticated;

-- 5. O texto que ela recebe ----------------------------------------------
-- Precisa caber numa olhada no celular e deixar a resposta óbvia. Ela
-- vai ler isso entre uma cliente e outra, não sentada no computador.
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

-- 6. Ela respondeu --------------------------------------------------------
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

  if aceitou then
    update public.appointments set status = 'confirmado'
    where id = appt and status = 'pendente';

    perform public.notificar(cliente, 'pedido_aceito', 'Horário confirmado', null, '/',
      jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
  else
    -- recusa devolve a vaga: o horário volta a aparecer para todo mundo
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

-- pela tela, a profissional resolve com um toque em vez do WhatsApp
drop function if exists public.responder_pedido(uuid, boolean);
create or replace function public.responder_pedido(appt uuid, aceitou boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  dona uuid;
begin
  select professional_id into dona from public.aceites where appointment_id = appt;
  if dona is null then
    return jsonb_build_object('ok', false, 'motivo', 'pedido não existe');
  end if;
  if not (public.is_professional(dona) or public.is_admin_do_salao(
            (select salon_id from public.aceites where appointment_id = appt))) then
    raise exception 'esse pedido não é seu';
  end if;
  return public.resolver_aceite(appt, aceitou);
end;
$$;

revoke execute on function public.responder_pedido(uuid, boolean) from public, anon;
grant execute on function public.responder_pedido(uuid, boolean) to authenticated;

-- 7. O prazo venceu -------------------------------------------------------
-- Sem pg_cron isto não roda sozinho. Enquanto isso, é chamada junto do
-- escoamento da fila — assim o vencimento acontece pelo menos toda vez
-- que alguém empurra as mensagens.
create or replace function public.resolver_aceites_vencidos()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  ac record;
  quantos integer := 0;
begin
  for ac in
    select a.appointment_id, p.ao_expirar
    from public.aceites a
    join public.professionals p on p.id = a.professional_id
    where a.resultado is null and a.expira_em < now()
  loop
    perform public.resolver_aceite(ac.appointment_id, ac.ao_expirar = 'confirma');
    update public.aceites set resultado = 'expirou'
    where appointment_id = ac.appointment_id;
    quantos := quantos + 1;
  end loop;
  return quantos;
end;
$$;

revoke execute on function public.resolver_aceites_vencidos()
  from public, anon, authenticated;

-- 8. Os pedidos dela, para a tela ----------------------------------------
drop function if exists public.meus_pedidos();
create or replace function public.meus_pedidos()
returns table (
  appointment_id uuid,
  cliente text,
  servico text,
  quando text,
  faltam_min integer
)
language sql
stable
security definer set search_path = public
as $$
  select ac.appointment_id,
         coalesce(nullif(btrim(pf.full_name), ''), 'Cliente'),
         coalesce(a.service_name, s.name, 'Atendimento'),
         public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI'),
         greatest(0, extract(epoch from (ac.expira_em - now()))/60)::integer
  from public.aceites ac
  join public.appointments a on a.id = ac.appointment_id
  left join public.profiles pf on pf.id = a.client_id
  left join public.services s on s.id = a.service_id
  where ac.resultado is null
    and (public.is_professional(ac.professional_id)
         or public.is_admin_do_salao(ac.salon_id))
  order by ac.expira_em;
$$;

revoke execute on function public.meus_pedidos() from public, anon;
grant execute on function public.meus_pedidos() to authenticated;

-- 9. O bot cria pedido, não agendamento pronto ---------------------------
-- Muda uma coisa só no fim da conversa: o status com que o horário
-- nasce, e o que a cliente ouve. O resto da máquina de estados fica
-- igual, porque o problema dela nunca foi esse.
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
  pedido jsonb;
begin
  select aceite_manual into manual from public.professionals where id = prof;

  insert into public.appointments
    (client_id, professional_id, salon_id, service_id,
     date, start_time, end_time, status)
  values
    (cliente, prof, salao, serv, dia, hora,
     (hora + make_interval(mins => dur))::time,
     case when coalesce(manual, false) then 'pendente' else 'confirmado' end)
  returning id into novo;

  if coalesce(manual, false) then
    pedido := public.pedir_aceite(novo);
    -- Se não deu para perguntar (ela não tem telefone), confirmar é
    -- melhor do que deixar a cliente esperando uma resposta que não vem.
    if not coalesce((pedido ->> 'ok')::boolean, false) then
      update public.appointments set status = 'confirmado' where id = novo;
      return jsonb_build_object('appointment_id', novo, 'pendente', false);
    end if;
    return jsonb_build_object('appointment_id', novo, 'pendente', true,
                              'minutos', pedido -> 'minutos');
  end if;

  return jsonb_build_object('appointment_id', novo, 'pendente', false);
end;
$$;

revoke execute on function
  public.fechar_pela_conversa(uuid, uuid, uuid, uuid, date, time, integer)
  from public, anon, authenticated;

-- 10. A resposta dela chega pelo mesmo webhook ---------------------------
-- Aqui mora o cuidado. "1" pode ser três coisas diferentes conforme quem
-- escreve e o que está aberto:
--   • a profissional com um pedido esperando  -> aceita
--   • a cliente no meio do menu do bot        -> opção 1
--   • a cliente respondendo um lembrete       -> confirma o horário
--
-- A ordem abaixo é a resposta, e ela não é arbitrária: o pedido de
-- aceite é o mais específico (é um número que TEM um pedido aberto agora)
-- e o mais urgente (tem prazo correndo), então vem primeiro.
create or replace function public.receber_mensagem(
  tel text, texto text, id_provedor text default null,
  id_enquete text default null, intencao_do_modelo text default null,
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

      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor, 'aceite:' || coalesce(r ->> 'resultado','?'),
              pedido, 'regra', intencao_do_modelo);

      return jsonb_build_object('acao', 'aceite_' || coalesce(r ->> 'resultado','?'),
        'appointment_id', pedido,
        'responder', case when acao = 'confirma'
          then '✅ Aceito! Já avisei a cliente. 💛'
          else '👍 Recusado. Avisei a cliente e o horário voltou a ficar livre.' end);
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

-- 11. O fim da conversa passa pelo aceite ---------------------------------
create or replace function public.avancar_conversa(
  tel text,
  texto text,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  c public.conversas%rowtype;
  cliente uuid;
  escolha jsonb;
  novas jsonb;
  d jsonb;
  cabecalho text := '';
  limpo text;
  dur integer;
  nome_serv text;
  prof_id uuid;
  prof_nome text;
  dia_esc date;
  hora_esc time;
  novo_appt uuid;
  fecho jsonb;
  quantos integer;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  limpo := lower(btrim(coalesce(texto, '')));
  limpo := translate(limpo, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');

  -- Sair da conversa é sagrado: tem que funcionar em qualquer passo, e
  -- tem que ser óbvio. Ninguém fica preso num menu.
  if limpo in ('cancelar', 'parar', 'sair', 'desistir', 'deixa', 'deixa pra la') then
    delete from public.conversas where telefone = e164;
    return jsonb_build_object('acao', 'desistiu',
      'responder', 'Tudo bem, cancelei por aqui. Quando quiser, é só chamar 💛');
  end if;

  -- conversa velha não vale: apaga antes de ler
  delete from public.conversas where telefone = e164 and expira_em < now();
  select * into c from public.conversas where telefone = e164;

  -- ---------------------------------------------------------------------
  -- Começo
  -- ---------------------------------------------------------------------
  if not found then
    -- Quem chama normalmente passa o salão, mas depender disso é frágil:
    -- basta a conversa expirar no meio para a próxima mensagem chegar sem
    -- ele, e a cliente receber silêncio. O histórico responde.
    if salao is null then
      select o.salon_id into salao
      from public.message_outbox o
      where o.telefone = e164
      order by o.criado_em desc
      limit 1;
    end if;
    if salao is null then
      return jsonb_build_object('acao', 'sem_canal');
    end if;

    cliente := public.cliente_pelo_telefone(e164);
    if cliente is null then
      -- O bot marca para quem já é cliente. Criar conta exige criar
      -- usuário de autenticação, que não é coisa para uma conversa de
      -- WhatsApp fazer sozinha — e um cadastro meia-boca vira cliente
      -- duplicada na agenda de alguém.
      return jsonb_build_object('acao', 'sem_cadastro');
    end if;

    -- os apelidos levam sufixo _c porque plpgsql resolve nome de coluna
    -- e de variável no mesmo escopo: uma coluna chamada "dur" ao lado da
    -- variável "dur" faz o Postgres recusar a consulta inteira
    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', id_c, 'rotulo', rotulo_c,
             'busca', nome_c, 'dur', dur_c))
      into novas
    from (
      select row_number() over (order by s.name) as linha_c,
             s.id as id_c, s.name as nome_c, s.duration_minutes as dur_c,
             s.name || ' · R$ ' || to_char(s.price, 'FM999G990D00') as rotulo_c
      from public.services s
      where s.salon_id = salao and s.active
      order by s.name
      limit 9
    ) t;

    if novas is null then
      return jsonb_build_object('acao', 'sem_servico',
        'responder', 'Ainda não tenho serviços cadastrados por aqui 😅');
    end if;

    insert into public.conversas (telefone, salon_id, client_id, estado, opcoes, dados)
    values (e164, salao, cliente, 'servico', novas, '{}'::jsonb);

    return jsonb_build_object('acao', 'perguntou', 'estado', 'servico',
      'responder', '💛 Vamos marcar! O que você quer fazer?' || E'\n\n'
                   || public.lista_numerada(novas) || E'\n\n'
                   || '_Responda com o número._');
  end if;

  escolha := public.escolher_opcao(c.opcoes, texto);
  if escolha is null then
    return jsonb_build_object('acao', 'nao_entendi', 'estado', c.estado,
      'responder', '🤔 Não peguei. Responda com o número de uma das opções:'
                   || E'\n\n' || public.lista_numerada(c.opcoes)
                   || E'\n\n' || '_Ou responda CANCELAR para parar._');
  end if;

  d := c.dados;

  -- ---------------------------------------------------------------------
  -- Escolheu o serviço -> quem atende
  -- ---------------------------------------------------------------------
  if c.estado = 'servico' then
    d := d || jsonb_build_object('servico_id', escolha ->> 'id',
                                 'servico', escolha ->> 'busca',
                                 'dur', (escolha ->> 'dur')::int);

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', id_c, 'rotulo', nome_c, 'busca', nome_c))
      into novas
    from (
      select row_number() over (order by p.name) as linha_c,
             p.id as id_c, p.name as nome_c
      from public.professionals p
      join public.professional_services ps on ps.professional_id = p.id
      where p.salon_id = c.salon_id and p.active
        and ps.service_id = (escolha ->> 'id')::uuid
      order by p.name
      limit 9
    ) t;

    if novas is null then
      delete from public.conversas where telefone = e164;
      return jsonb_build_object('acao', 'sem_profissional',
        'responder', 'Ninguém está atendendo esse serviço agora 😕 Me chama que a gente dá um jeito.');
    end if;

    select count(*) into quantos from jsonb_array_elements(novas);

    -- uma profissional só: perguntar seria burocracia
    if quantos = 1 then
      escolha := novas -> 0;
      cabecalho := '✨ ' || (d ->> 'servico') || ' com *' || (escolha ->> 'rotulo') || '*' || E'\n\n';
      d := d || jsonb_build_object('prof_id', escolha ->> 'id', 'prof', escolha ->> 'rotulo');
      c.estado := 'profissional';
    else
      update public.conversas
      set estado = 'profissional', dados = d, opcoes = novas,
          atualizada_em = now(), expira_em = now() + interval '30 minutes'
      where telefone = e164;

      return jsonb_build_object('acao', 'perguntou', 'estado', 'profissional',
        'responder', '✨ ' || (d ->> 'servico') || '! Com quem você prefere?'
                     || E'\n\n' || public.lista_numerada(novas)
                     || E'\n\n' || '_Responda com o número._');
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu quem atende -> que dia
  -- ---------------------------------------------------------------------
  if c.estado = 'profissional' then
    if d ->> 'prof_id' is null then
      d := d || jsonb_build_object('prof_id', escolha ->> 'id', 'prof', escolha ->> 'rotulo');
    end if;
    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', dia_c::text, 'rotulo', rotulo_c, 'busca', rotulo_c))
      into novas
    from (
      select row_number() over (order by v.dia) as linha_c, v.dia as dia_c,
             public.dia_por_extenso(v.dia) || ' · ' || v.vagas || ' horários' as rotulo_c
      from public.dias_com_vaga(prof_id, dur, 5) v
    ) t;

    if novas is null then
      delete from public.conversas where telefone = e164;
      return jsonb_build_object('acao', 'sem_vaga',
        'responder', 'Puxa, a agenda dela está cheia nos próximos dias 😕'
                     || E'\n\n' || 'Me chama que a gente encaixa você.');
    end if;

    update public.conversas
    set estado = 'dia', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'dia',
      'responder', cabecalho || '📅 Que dia fica melhor?' || E'\n\n'
                   || public.lista_numerada(novas)
                   || E'\n\n' || '_Responda com o número._');
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu o dia -> que horas
  -- ---------------------------------------------------------------------
  if c.estado = 'dia' then
    d := d || jsonb_build_object('dia', escolha ->> 'id');
    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;
    dia_esc := (d ->> 'dia')::date;

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', to_char(hora_c, 'HH24:MI'),
             'rotulo', to_char(hora_c, 'HH24:MI'), 'busca', to_char(hora_c, 'HH24:MI')))
      into novas
    from (
      select row_number() over (order by h.hora) as linha_c, h.hora as hora_c
      from public.horarios_livres(prof_id, dia_esc, dur) h
      limit 9
    ) t;

    if novas is null then
      -- alguém pegou o dia entre a pergunta e a resposta
      update public.conversas set estado = 'profissional', dados = d,
             atualizada_em = now() where telefone = e164;
      return jsonb_build_object('acao', 'dia_lotou',
        'responder', 'Esse dia acabou de encher 😕 Responda qualquer coisa que eu mostro os outros.');
    end if;

    update public.conversas
    set estado = 'hora', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'hora',
      'responder', '🕒 ' || public.dia_por_extenso(dia_esc) || '. Que horas?'
                   || E'\n\n' || public.lista_numerada(novas)
                   || E'\n\n' || '_Responda com o número._');
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu a hora -> confere antes de marcar
  -- ---------------------------------------------------------------------
  if c.estado = 'hora' then
    d := d || jsonb_build_object('hora', escolha ->> 'id');
    novas := jsonb_build_array(
      jsonb_build_object('n', 1, 'id', 'sim', 'rotulo', 'Confirmar', 'busca', 'confirmar sim isso'),
      jsonb_build_object('n', 2, 'id', 'nao', 'rotulo', 'Recomeçar',  'busca', 'recomecar nao mudar'));

    update public.conversas
    set estado = 'confirma', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'confirma',
      'responder', 'Confere pra mim:' || E'\n\n'
                   || '✨ ' || (d ->> 'servico') || E'\n'
                   || '👩 com *' || (d ->> 'prof') || '*' || E'\n'
                   || '🗓️ ' || public.dia_por_extenso((d ->> 'dia')::date)
                   || ' às ' || (d ->> 'hora') || E'\n\n'
                   || public.lista_numerada(novas));
  end if;

  -- ---------------------------------------------------------------------
  -- Confirmou -> marca de verdade
  -- ---------------------------------------------------------------------
  if c.estado = 'confirma' then
    if (escolha ->> 'id') = 'nao' then
      delete from public.conversas where telefone = e164;
      return public.avancar_conversa(e164, 'recomecar', c.salon_id);
    end if;

    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;
    dia_esc := (d ->> 'dia')::date;
    hora_esc := (d ->> 'hora')::time;
    nome_serv := d ->> 'servico';
    prof_nome := d ->> 'prof';

    -- Entre a pergunta e a resposta dela, alguém pode ter marcado. O
    -- índice único de (data, hora) barra o choque, mas conferir antes
    -- deixa a resposta decente em vez de um erro de banco.
    if not exists (
      select 1 from public.horarios_livres(prof_id, dia_esc, dur) h
      where h.hora = hora_esc
    ) then
      update public.conversas set estado = 'profissional', atualizada_em = now()
      where telefone = e164;
      return jsonb_build_object('acao', 'hora_foi',
        'responder', 'Que pena, pegaram esse horário agora 😕'
                     || E'\n\n' || 'Responda qualquer coisa que eu mostro os que sobraram.');
    end if;

    fecho := public.fechar_pela_conversa(
               c.client_id, prof_id, c.salon_id, (d ->> 'servico_id')::uuid,
               dia_esc, hora_esc, dur);
    novo_appt := (fecho ->> 'appointment_id')::uuid;

    delete from public.conversas where telefone = e164;

    -- Quem espera aceite ouve outra coisa. Dizer "marcado" e depois
    -- voltar atrás seria pior do que ser honesto agora.
    if coalesce((fecho ->> 'pendente')::boolean, false) then
      return jsonb_build_object('acao', 'pediu', 'appointment_id', novo_appt,
        'responder', '📩 *Pedido enviado!*' || E'\n\n'
                     || '✨ ' || nome_serv || E'\n'
                     || '👩 com *' || prof_nome || '*' || E'\n'
                     || '🗓️ ' || public.dia_por_extenso(dia_esc) || ' às '
                     || to_char(hora_esc, 'HH24:MI') || E'\n\n'
                     || 'Guardei esse horário pra você. Assim que a *'
                     || prof_nome || '* confirmar, eu te aviso aqui 💛');
    end if;

    return jsonb_build_object('acao', 'marcou', 'appointment_id', novo_appt,
      'responder', '✅ *Marcado!*' || E'\n\n'
                   || '✨ ' || nome_serv || E'\n'
                   || '👩 com *' || prof_nome || '*' || E'\n'
                   || '🗓️ ' || public.dia_por_extenso(dia_esc) || ' às '
                   || to_char(hora_esc, 'HH24:MI') || E'\n\n'
                   || 'Te espero! Se precisar mudar, é só me chamar 💛');
  end if;

  return jsonb_build_object('acao', 'nada');
end;
$$;

revoke execute on function public.avancar_conversa(text, text, uuid)
  from public, anon, authenticated;
