-- =============================================================
-- Agenda Mel — 021: histórico de exemplo
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 020).
--
-- As telas novas (o mês em números e "quem sumiu") só dizem
-- alguma coisa se houver passado. Este arquivo inventa dois
-- meses de atendimentos concluídos, duas clientes a mais e uma
-- cliente que faz tempo que não aparece.
--
-- Rodar de novo é seguro: se o histórico já existe, não repete.
-- =============================================================

set search_path = public, extensions;

do $$
declare
  salao uuid;
  prof uuid;
  serv_limpeza uuid;
  serv_sobrancelha uuid;
  serv_massagem uuid;
  uid_cliente uuid;
  uid_bruna uuid;
  uid_sofia uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  d date;
  i integer;
  clientes uuid[];
  servicos uuid[];
  duracoes integer[];
  precos integer[];
  esc integer;
  hora time;
begin
  select id into salao from public.salons where slug = 'espaco-mel';
  select id into prof from public.professionals where slug = 'ana-paula';
  if salao is null or prof is null then
    raise notice 'Rode o 018 antes: o salão de exemplo ainda não existe.';
    return;
  end if;

  -- 1. Cada serviço ganha o seu ritmo de retorno -------------------------
  update public.services set return_days = 30
    where salon_id = salao and name = 'Limpeza de pele' and return_days is null;
  update public.services set return_days = 21
    where salon_id = salao and name = 'Design de sobrancelhas' and return_days is null;
  update public.services set return_days = 45
    where salon_id = salao and name = 'Massagem relaxante' and return_days is null;
  update public.services set return_days = 60
    where salon_id = salao and name = 'Dia de cuidado' and return_days is null;

  select id into serv_limpeza from public.services
    where salon_id = salao and name = 'Limpeza de pele';
  select id into serv_sobrancelha from public.services
    where salon_id = salao and name = 'Design de sobrancelhas';
  select id into serv_massagem from public.services
    where salon_id = salao and name = 'Massagem relaxante';

  select id into uid_cliente from auth.users where email = 'cliente@exemplo.com';

  -- 2. Mais duas clientes, para o histórico não ser de uma pessoa só -----
  select id into uid_bruna from auth.users where email = 'bruna@exemplo.com';
  if uid_bruna is null then
    uid_bruna := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_bruna, 'authenticated',
      'authenticated', 'bruna@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Bruna Alves","phone":"(13) 99700-1188"}',
      now(), now(), '', '', '', ''
    );
  end if;

  select id into uid_sofia from auth.users where email = 'sofia@exemplo.com';
  if uid_sofia is null then
    uid_sofia := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_sofia, 'authenticated',
      'authenticated', 'sofia@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Sofia Ramos","phone":"(13) 99700-2244"}',
      now(), now(), '', '', '', ''
    );
  end if;

  -- 3. Dois meses de atendimentos concluídos ----------------------------
  -- (só entra se ainda não houver histórico; assim rodar de novo não duplica)
  if exists (
    select 1 from public.appointments
    where professional_id = prof and status = 'concluido'
  ) then
    raise notice 'Histórico de exemplo já existe — nada a fazer.';
    return;
  end if;

  -- Juliana é a cliente antiga; Bruna começou há pouco (conta como nova
  -- no mês); Sofia é a que sumiu, e só aparece lá embaixo.
  servicos := array[serv_limpeza, serv_sobrancelha, serv_massagem];
  duracoes := array[60, 45, 60];
  precos   := array[12000, 6000, 13000];

  i := 0;
  -- de 62 dias atrás até anteontem, pulando domingo e segunda (folga)
  for d in select generate_series(hoje - 62, hoje - 2, interval '1 day')::date loop
    if extract(dow from d) in (0, 1) then
      continue;
    end if;
    -- dois ou três atendimentos por dia, alternando
    for esc in 1..(2 + (i % 2)) loop
      i := i + 1;
      hora := (time '09:00') + make_interval(hours => (esc - 1) * 3);
      clientes := array[
        case when esc > 1 and d >= hoje - 25 then uid_bruna else uid_cliente end
      ];
      insert into public.appointments
        (client_id, professional_id, service_id, date, start_time, end_time,
         status, price_cents, service_name)
      select clientes[1],
             prof,
             servicos[1 + (i % 3)],
             d,
             hora,
             hora + make_interval(mins => duracoes[1 + (i % 3)]),
             -- uma falta a cada quinze atendimentos, para a taxa não ser zero
             case when i % 15 = 0 then 'faltou' else 'concluido' end,
             precos[1 + (i % 3)],
             s.name
      from public.services s
      where s.id = servicos[1 + (i % 3)]
      on conflict do nothing;
    end loop;
  end loop;

  -- 4. Uma cliente que sumiu --------------------------------------------
  -- Sofia fez sobrancelha (volta em 21 dias) e não aparece há 50
  insert into public.appointments
    (client_id, professional_id, service_id, date, start_time, end_time,
     status, price_cents, service_name)
  values (uid_sofia, prof, serv_sobrancelha, hoje - 50, '16:00', '16:45',
          'concluido', 6000, 'Design de sobrancelhas')
  on conflict do nothing;

  raise notice 'Histórico criado: % atendimentos.', i;
end;
$$;

-- =============================================================
-- Conferência rápida
-- =============================================================
select count(*) filter (where status = 'concluido') as concluidos,
       count(*) filter (where status = 'faltou') as faltas,
       min(date) as desde,
       max(date) as ate
from public.appointments a
join public.professionals p on p.id = a.professional_id
where p.slug = 'ana-paula';
