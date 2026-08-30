-- =============================================================
-- Agenda Mel — 018: contas e dados de teste
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 017).
--
-- Cria três contas prontas para usar, com salão, equipe, serviços,
-- horários e alguns agendamentos. Todas com a MESMA SENHA:
--
--   admin@exemplo.com         → dona do salão   (cai em /admin)
--   profissional@exemplo.com  → profissional    (cai em /pro)
--   cliente@exemplo.com       → cliente         (cai em /)
--
--   senha de todas: agendamel123
--
-- Rodar de novo é seguro: se as contas já existirem, nada é
-- duplicado. Para começar do zero, use o bloco de limpeza no fim.
-- =============================================================

set search_path = public, extensions;

-- crypt() e gen_salt() vêm do pgcrypto
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  uid_admin uuid;
  uid_pro uuid;
  uid_cliente uuid;
  salao uuid;
  prof uuid;
  serv_limpeza uuid;
  serv_sobrancelha uuid;
  serv_massagem uuid;
  serv_combo uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- ---------------------------------------------------------
  -- 1. As três contas
  -- ---------------------------------------------------------
  select id into uid_admin from auth.users where email = 'admin@exemplo.com';
  if uid_admin is null then
    uid_admin := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_admin, 'authenticated',
      'authenticated', 'admin@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Mel Tedesco","phone":"(13) 99871-0001"}',
      now(), now(), '', '', '', ''
    );
  end if;

  select id into uid_pro from auth.users where email = 'profissional@exemplo.com';
  if uid_pro is null then
    uid_pro := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_pro, 'authenticated',
      'authenticated', 'profissional@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Ana Paula Ribeiro","phone":"(13) 99871-0002"}',
      now(), now(), '', '', '', ''
    );
  end if;

  select id into uid_cliente from auth.users where email = 'cliente@exemplo.com';
  if uid_cliente is null then
    uid_cliente := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_cliente, 'authenticated',
      'authenticated', 'cliente@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Juliana Prado","phone":"(13) 99871-0003"}',
      now(), now(), '', '', '', ''
    );
  end if;

  -- ---------------------------------------------------------
  -- 2. Identidade de e-mail (o login por senha depende dela)
  --    A coluna provider_id só existe nas versões novas do Auth.
  -- ---------------------------------------------------------
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities'
      and column_name = 'provider_id'
  ) then
    insert into auth.identities (id, user_id, identity_data, provider, provider_id,
                                 last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), u.id,
           jsonb_build_object('sub', u.id::text, 'email', u.email),
           'email', u.email, now(), now(), now()
    from auth.users u
    where u.email in ('admin@exemplo.com', 'profissional@exemplo.com', 'cliente@exemplo.com')
      and not exists (
        select 1 from auth.identities i
        where i.user_id = u.id and i.provider = 'email'
      );
  else
    insert into auth.identities (id, user_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), u.id,
           jsonb_build_object('sub', u.id::text, 'email', u.email),
           'email', now(), now(), now()
    from auth.users u
    where u.email in ('admin@exemplo.com', 'profissional@exemplo.com', 'cliente@exemplo.com')
      and not exists (
        select 1 from auth.identities i
        where i.user_id = u.id and i.provider = 'email'
      );
  end if;

  -- o gatilho de cadastro cria o perfil; se faltar, criamos aqui
  insert into public.profiles (id, full_name, phone, referral_code)
  select u.id,
         u.raw_user_meta_data ->> 'full_name',
         u.raw_user_meta_data ->> 'phone',
         public.gerar_codigo_indicacao(u.raw_user_meta_data ->> 'full_name')
  from auth.users u
  where u.email in ('admin@exemplo.com', 'profissional@exemplo.com', 'cliente@exemplo.com')
    and not exists (select 1 from public.profiles p where p.id = u.id);

  update public.profiles set role = 'admin' where id = uid_admin;
  update public.profiles set role = 'profissional' where id = uid_pro;
  update public.profiles set role = 'cliente' where id = uid_cliente;

  -- ---------------------------------------------------------
  -- 3. O salão
  -- ---------------------------------------------------------
  select id into salao from public.salons where slug = 'espaco-mel';
  if salao is null then
    insert into public.salons (name, slug, owner_id, city, phone)
    values ('Espaço Mel', 'espaco-mel', uid_admin, 'Santos', '(13) 3232-0000')
    returning id into salao;
  else
    update public.salons set owner_id = uid_admin where id = salao;
  end if;

  insert into public.salon_members (salon_id, user_id, papel)
  values (salao, uid_admin, 'admin')
  on conflict do nothing;

  -- horário padrão do salão: terça a sábado
  insert into public.business_hours (salon_id, weekday, open, start_time, end_time)
  values
    (salao, 0, false, '09:00', '18:00'),
    (salao, 1, false, '09:00', '18:00'),
    (salao, 2, true,  '09:00', '19:00'),
    (salao, 3, true,  '09:00', '19:00'),
    (salao, 4, true,  '09:00', '19:00'),
    (salao, 5, true,  '09:00', '20:00'),
    (salao, 6, true,  '08:00', '15:00')
  on conflict (salon_id, weekday) do update
    set open = excluded.open,
        start_time = excluded.start_time,
        end_time = excluded.end_time;

  -- ---------------------------------------------------------
  -- 4. Serviços
  -- ---------------------------------------------------------
  select id into serv_limpeza from public.services
  where salon_id = salao and name = 'Limpeza de pele';
  if serv_limpeza is null then
    insert into public.services (salon_id, name, description, duration_minutes, price)
    values (salao, 'Limpeza de pele', 'Higienização profunda com extração e máscara calmante.', 60, 120)
    returning id into serv_limpeza;
  end if;

  select id into serv_sobrancelha from public.services
  where salon_id = salao and name = 'Design de sobrancelhas';
  if serv_sobrancelha is null then
    insert into public.services (salon_id, name, description, duration_minutes, price)
    values (salao, 'Design de sobrancelhas', 'Mapeamento facial, pinça e finalização.', 45, 60)
    returning id into serv_sobrancelha;
  end if;

  select id into serv_massagem from public.services
  where salon_id = salao and name = 'Massagem relaxante';
  if serv_massagem is null then
    insert into public.services (salon_id, name, description, duration_minutes, price)
    values (salao, 'Massagem relaxante', 'Corpo inteiro, com óleo morno.', 60, 130)
    returning id into serv_massagem;
  end if;

  -- um combo, para ver o "tempo médio" funcionando
  select id into serv_combo from public.services
  where salon_id = salao and name = 'Dia de cuidado';
  if serv_combo is null then
    insert into public.services
      (salon_id, name, description, duration_minutes, price, is_combo, combo_service_ids)
    values (salao, 'Dia de cuidado', 'Limpeza de pele + sobrancelhas, com desconto.',
            105, 160, true, array[serv_limpeza, serv_sobrancelha])
    returning id into serv_combo;
  end if;

  -- ---------------------------------------------------------
  -- 5. A profissional
  -- ---------------------------------------------------------
  select id into prof from public.professionals where slug = 'ana-paula';
  if prof is null then
    insert into public.professionals
      (salon_id, user_id, name, slug, bio, phone, buffer_minutes)
    values (salao, uid_pro, 'Ana Paula', 'ana-paula',
            'Especialista em limpeza de pele e design de sobrancelhas. Atendo com hora marcada no Espaço Mel.',
            '(13) 99871-0002', 10)
    returning id into prof;
  else
    update public.professionals
    set salon_id = salao, user_id = uid_pro, buffer_minutes = 10
    where id = prof;
  end if;

  insert into public.salon_members (salon_id, user_id, papel)
  values (salao, uid_pro, 'profissional')
  on conflict do nothing;

  -- ela atende todos os serviços
  insert into public.professional_services (professional_id, service_id)
  select prof, s.id from public.services s where s.salon_id = salao
  on conflict do nothing;

  -- almoço todo dia útil e folga na segunda
  insert into public.professional_blocks
    (professional_id, kind, weekday, all_day, start_time, end_time, reason)
  select prof, 'semanal', d, false, '12:00', '13:00', 'Almoço'
  from generate_series(2, 6) as d
  where not exists (
    select 1 from public.professional_blocks b
    where b.professional_id = prof and b.kind = 'semanal'
      and b.weekday = d and b.reason = 'Almoço'
  );

  -- ---------------------------------------------------------
  -- 6. Alguns agendamentos para a agenda não nascer vazia
  -- ---------------------------------------------------------
  if not exists (select 1 from public.appointments where professional_id = prof) then
    insert into public.appointments
      (client_id, professional_id, service_id, date, start_time, end_time, status)
    values
      (uid_cliente, prof, serv_limpeza, hoje, '09:00', '10:00', 'confirmado'),
      (uid_cliente, prof, serv_sobrancelha, hoje + 2, '14:00', '14:45', 'pendente');

    -- uma cliente de encaixe, sem conta no app
    insert into public.appointments
      (professional_id, service_id, date, start_time, end_time, status,
       guest_name, guest_phone)
    values
      (prof, serv_massagem, hoje, '15:30', '16:30', 'confirmado',
       'Carla Mendes', '(13) 98122-4409');
  end if;

  raise notice 'Pronto! Salão %, profissional % e três contas criadas.', salao, prof;
end;
$$;

-- =============================================================
-- Conferência rápida
-- =============================================================
select u.email,
       p.role,
       p.full_name,
       p.referral_code as codigo_indicacao
from auth.users u
join public.profiles p on p.id = u.id
where u.email in ('admin@exemplo.com', 'profissional@exemplo.com', 'cliente@exemplo.com')
order by p.role;

-- =============================================================
-- LIMPEZA — apaga as contas de teste e tudo que veio com elas.
-- Descomente e rode só se quiser começar do zero.
--
-- delete from auth.users
-- where email in ('admin@exemplo.com', 'profissional@exemplo.com', 'cliente@exemplo.com');
-- delete from public.salons where slug = 'espaco-mel';
-- =============================================================
