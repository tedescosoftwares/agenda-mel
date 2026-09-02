-- =============================================================
-- Agenda Mel — 032: a profissional fica sabendo
--
-- Hoje, quando uma cliente marca pelo app, a profissional só descobre
-- se abrir a agenda. O único aviso de 'novo_agendamento' que existia
-- era o da lista de espera, e a regra estava com envia = false, então
-- nem esse saía.
--
-- Isto fecha os dois lados: marcou, ela sabe. Cancelou, ela sabe também
-- — que é o aviso que mais importa, porque é o horário que ela pode
-- oferecer para outra pessoa.
-- =============================================================

-- 1. Texto para quem ATENDE, não para quem é atendida ---------------------
-- O montar_texto_whatsapp() recebe o destinatário em 'cliente' e usa o
-- primeiro nome dele. Isso serve para mensagem que vai PARA a cliente.
-- Numa mensagem para a profissional, o nome que interessa é o de quem
-- marcou — que está no agendamento, não no destinatário.
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
  -- escalares, não RECORD: ler campo de record não atribuído levanta
  -- erro, e como o notificar() engole exceção da fila, a mensagem
  -- sumiria em silêncio
  d_data date;
  d_hora time;
  servico text;
  prof_nome text;
  prof_slug text;
  base text;
  link text;
  link_app text;
  nome_cliente text;
  nome_na_agenda text;   -- quem marcou, para as mensagens da profissional
  tel_na_agenda text;
  quando text;
  quando_longo text;
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name),
           ap.professional_id,
           nullif(btrim(coalesce(cl.full_name, '')), ''),
           cl.phone
      into d_data, d_hora, servico, prof, nome_na_agenda, tel_na_agenda
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    left join public.profiles cl on cl.id = ap.client_id
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
    -- Para a profissional vale o dia da semana: ela pensa em "quinta",
    -- não em "18/09". O to_char com TMDay NÃO serve aqui — ele depende do
    -- lc_time do banco, que no Supabase é C, e devolveria "Wednesday" no
    -- WhatsApp da cliente. Tabela na mão é feio e está certo.
    quando_longo :=
      (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])
        [extract(dow from d_data)::int + 1]
      || ', ' || quando;
  end if;

  case tipo

  -- ---- mensagens para a PROFISSIONAL -----------------------------------
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

  -- ---- mensagens para a CLIENTE ----------------------------------------
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
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Está tudo certo:' || E'\n\n'
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
      || ' guardou um lugar pra você.' || E'\n\n'
      || 'Quer já deixar marcado?'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'pos_atendimento' then
    return
      '💅 *Obrigada pela visita!*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Espero que tenha gostado.'
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

-- 2. As regras ------------------------------------------------------------
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('cancelou_comigo', true, 'utilidade', null)
on conflict (kind) do nothing;

-- novo_agendamento nasceu desligado em 023 porque não havia texto para ele.
-- Agora há.
update public.whatsapp_regras set envia = true, natureza = 'utilidade'
where kind in ('novo_agendamento', 'cancelou_comigo');

-- 3. Quem avisar ----------------------------------------------------------
-- A profissional tem duas identidades: a linha em professionals e a conta
-- de login em profiles. O WhatsApp sai pelo telefone do PERFIL, porque é
-- ele que enfileirar_whatsapp() lê. Sem conta de login, não há para onde
-- mandar — e é por isso que o diagnóstico mais abaixo confere isso.
create or replace function public.conta_da_profissional(prof uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select user_id from public.professionals where id = prof;
$$;

revoke execute on function public.conta_da_profissional(uuid)
  from public, anon, authenticated;

-- 4. Marcou: ela sabe -----------------------------------------------------
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
    return new;                       -- profissional sem conta de login
  end if;

  -- quando a própria profissional marca para si mesma, avisar é ruído
  if conta = new.client_id then
    return new;
  end if;

  perform public.notificar(
    conta,
    'novo_agendamento',
    'Horário novo na sua agenda',
    null,
    '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id)
  );
  return new;
end;
$$;

drop trigger if exists tg_avisa_profissional_novo on public.appointments;
create trigger tg_avisa_profissional_novo
  after insert on public.appointments
  for each row execute function public.avisa_profissional_do_agendamento();

-- 5. Cancelou: ela sabe também --------------------------------------------
-- Este é o aviso que mais vale: horário cancelado é horário que ela pode
-- oferecer para outra pessoa, e quanto antes souber, melhor.
create or replace function public.avisa_profissional_do_cancelamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;

  conta := public.conta_da_profissional(new.professional_id);
  if conta is null or conta = new.client_id then
    return new;
  end if;

  perform public.notificar(
    conta,
    'cancelou_comigo',
    'Cancelaram um horário',
    null,
    '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id)
  );
  return new;
end;
$$;

drop trigger if exists tg_avisa_profissional_cancelou on public.appointments;
create trigger tg_avisa_profissional_cancelou
  after update of status on public.appointments
  for each row execute function public.avisa_profissional_do_cancelamento();

-- 6. Uma profissional com telefone de verdade, para testar --------------
-- Sem alguém com telefone utilizável, nada disso sai da fila. A Ana Paula
-- do seed tem um número de mentira.
do $$
declare
  salao uuid;
  uid uuid;
  prof uuid;
begin
  select id into salao from public.salons where slug = 'espaco-mel';
  if salao is null then
    raise notice '032: salão de exemplo não existe; pulando a profissional de teste.';
    return;
  end if;

  select id into uid from auth.users where email = 'mel@exemplo.com';
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated',
      'authenticated', 'mel@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Mel Tedesco","phone":"(13) 99120-3410"}',
      now(), now(), '', '', '', ''
    );
  end if;

  -- o telefone TEM que estar no perfil: é dele que a fila lê, não do
  -- cadastro da profissional
  update public.profiles
     set role = 'profissional',
         full_name = coalesce(nullif(btrim(full_name), ''), 'Mel Tedesco'),
         phone = '(13) 99120-3410',
         accepts_reminders = true
   where id = uid;

  select id into prof from public.professionals where slug = 'mel';
  if prof is null then
    insert into public.professionals
      (salon_id, user_id, name, slug, bio, phone, buffer_minutes)
    values (salao, uid, 'Mel', 'mel',
            'Atendo com hora marcada no Espaço Mel.',
            '(13) 99120-3410', 10)
    returning id into prof;
  else
    update public.professionals
       set salon_id = salao, user_id = uid, phone = '(13) 99120-3410', active = true
     where id = prof;
  end if;

  insert into public.salon_members (salon_id, user_id, papel)
  values (salao, uid, 'profissional')
  on conflict do nothing;

  insert into public.professional_services (professional_id, service_id)
  select prof, s.id from public.services s where s.salon_id = salao
  on conflict do nothing;

  -- de segunda a sábado; os 7 dias já nascem pelo gatilho do 007
  update public.professional_hours
     set open = true, start_time = '09:00', end_time = '19:00'
   where professional_id = prof and weekday between 1 and 6;
end $$;

-- 7. Por que a mensagem não chegou ---------------------------------------
-- Toda vez que "não chegou nada", a causa está numa destas linhas. Em vez
-- de caçar em cinco tabelas, a tela do admin pergunta aqui.
drop function if exists public.diagnostico_whatsapp(uuid);
create or replace function public.diagnostico_whatsapp(salao uuid)
returns table (
  item text,
  situacao text,
  detalhe text
)
language plpgsql
stable
security definer set search_path = public
as $fn$
begin
  -- SECURITY DEFINER sem esta linha entrega a configuração de qualquer
  -- salão para qualquer pessoa logada. A RLS não protege o que roda como
  -- dono; a trava tem que ser explícita.
  if not public.is_admin_do_salao(salao) then
    return;
  end if;

  return query
  with c as (
    select * from public.whatsapp_channels where salon_id = salao
  )
  select 'Canal do salão',
         case when (select count(*) from c) = 0 then 'falta'
              when (select ativo from c) then 'ok' else 'desligado' end,
         coalesce((select 'canal ' || canal ||
                   coalesce(' · ' || numero_exibicao, '') from c),
                  'nenhum canal cadastrado')
  union all
  select 'Endereço público do app',
         case when (select app_url from public.salons where id = salao) is null
              then 'falta' else 'ok' end,
         coalesce((select app_url from public.salons where id = salao),
                  'sem isso as mensagens saem sem o link da agenda')
  union all
  select 'Regra novo_agendamento',
         case when (select envia from public.whatsapp_regras
                     where kind = 'novo_agendamento') then 'ok' else 'desligado' end,
         'avisa a profissional quando alguém marca'
  union all
  select 'Profissionais que recebem',
         case when count(*) filter (where tem_tudo) = 0 then 'falta'
              when count(*) filter (where not tem_tudo) > 0 then 'parcial'
              else 'ok' end,
         count(*) filter (where tem_tudo) || ' de ' || count(*) ||
         ' com conta, telefone e avisos ligados'
  from (
    select p.id,
           (p.user_id is not null
            and public.telefone_e164(pf.phone) is not null
            and coalesce(pf.accepts_reminders, false)) as tem_tudo
    from public.professionals p
    left join public.profiles pf on pf.id = p.user_id
    where p.salon_id = salao and p.active
  ) x
  union all
  select 'Telefones repetidos',
         case when count(*) = 0 then 'ok' else 'atenção' end,
         case when count(*) = 0 then 'cada telefone pertence a uma pessoa só'
              else 'o mesmo número está em ' || count(*) ||
                   ' perfis; a resposta "1" no WhatsApp vira ambígua' end
  from (
    select public.telefone_e164(phone) t
    from public.profiles where phone is not null
    group by 1 having count(*) > 1
  ) y
  union all
  select 'Fila de hoje',
         'ok',
         count(*) filter (where status = 'na_fila') || ' esperando · ' ||
         count(*) filter (where status in ('enviado','entregue','lido')) || ' enviadas · ' ||
         count(*) filter (where status = 'falhou') || ' falharam'
  from public.message_outbox
  where salon_id = salao
    and (criado_em at time zone 'America/Sao_Paulo')::date
        = (public.agora_local())::date;
end;
$fn$;

revoke execute on function public.diagnostico_whatsapp(uuid) from public, anon;
grant execute on function public.diagnostico_whatsapp(uuid) to authenticated;

-- 8. A fila inteira do salão, para a tela do admin ------------------------
-- O /pro/enviar mostra a fila de UMA profissional. O admin precisa ver a
-- do salão, incluindo as que já saíram, para conferir o que foi mandado.
drop function if exists public.fila_do_salao(uuid, integer);
create or replace function public.fila_do_salao(salao uuid, quantas integer default 30)
returns table (
  id uuid,
  quando timestamptz,
  para text,
  telefone text,
  tipo text,
  status text,
  corpo text,
  link_wa text
)
language sql
stable
security definer set search_path = public
as $$
  select o.id,
         coalesce(o.enviado_em, o.criado_em),
         coalesce(nullif(btrim(pf.full_name), ''), 'sem nome'),
         o.telefone,
         o.kind,
         o.status,
         o.corpo,
         'https://wa.me/' || o.telefone || '?text=' || public.url_encode_simples(o.corpo)
  from public.message_outbox o
  left join public.profiles pf on pf.id = o.client_id
  where o.salon_id = salao
    and public.is_admin_do_salao(salao)
  order by coalesce(o.enviado_em, o.criado_em) desc
  limit greatest(1, least(coalesce(quantas, 30), 200));
$$;

revoke execute on function public.fila_do_salao(uuid, integer) from public, anon;
grant execute on function public.fila_do_salao(uuid, integer) to authenticated;
