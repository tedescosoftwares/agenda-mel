-- =============================================================
-- Agenda Mel — 019: a cliente volta sozinha
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 018).
--
-- Três lembranças que a agenda passa a dar por conta própria:
--   1. véspera  — "amanhã às 14h com a Ana"
--   2. depois   — "obrigada por hoje; costuma voltar em 30 dias"
--   3. sumiço   — a lista de quem passou do tempo de voltar,
--                 com um toque para chamar de volta
--
-- Duas regras atravessam tudo: a cliente pode desligar os avisos,
-- e ninguém é chamado duas vezes dentro do intervalo de descanso.
-- =============================================================

-- 1. Em quantos dias faz sentido voltar ----------------------------------
-- unha em 30, corte em 60, escova em 15… cada serviço tem o seu ritmo
alter table public.services
  add column if not exists return_days integer
    check (return_days is null or return_days between 1 and 365);

-- 2. O que cada profissional quer que a agenda faça ----------------------
alter table public.professionals
  -- 0 desliga o lembrete de véspera
  add column if not exists reminder_hours_before integer not null default 24
    check (reminder_hours_before between 0 and 168);

alter table public.professionals
  add column if not exists followup_active boolean not null default true;

alter table public.professionals
  -- descanso entre duas chamadas para a mesma cliente
  add column if not exists winback_cooldown_days integer not null default 45
    check (winback_cooldown_days between 7 and 365);

alter table public.professionals
  -- quando não há tempo de retorno no serviço, vale este
  add column if not exists winback_after_days integer not null default 45
    check (winback_after_days between 7 and 365);

-- 3. A cliente manda nos próprios avisos ---------------------------------
alter table public.profiles
  add column if not exists accepts_reminders boolean not null default true;

-- ela mesma pode desligar (a coluna entra na lista do grant restrito)
grant update (full_name, phone, accepts_reminders) on public.profiles to authenticated;

-- 4. Registro de quem já foi chamado -------------------------------------
-- existe para uma coisa só: não encher o saco da mesma pessoa
create table if not exists public.client_nudges (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('lembrete', 'pos_atendimento', 'retorno')),
  appointment_id uuid references public.appointments (id) on delete set null,
  service_id uuid references public.services (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists nudges_prof_cliente_idx
  on public.client_nudges (professional_id, client_id, kind, created_at desc);

alter table public.client_nudges enable row level security;

drop policy if exists "equipe ve as chamadas" on public.client_nudges;
create policy "equipe ve as chamadas"
  on public.client_nudges for select
  to authenticated
  using (
    public.is_professional(professional_id)
    or public.is_admin_do_salao(
      (select salon_id from public.professionals where id = professional_id))
  );

-- escrever é só pelas funções abaixo
revoke insert, update, delete on public.client_nudges from authenticated, anon;

-- 5. Lembrete de véspera -------------------------------------------------
alter table public.appointments
  add column if not exists reminder_sent_at timestamptz;

-- Roda de graça e é idempotente: só manda o que ainda não foi mandado,
-- e só para quem aceita. Qualquer sessão aberta pode chamar — o app faz
-- isso ao abrir, e o pg_cron faz de hora em hora se estiver ligado.
create or replace function public.enviar_lembretes()
returns integer
language plpgsql
security definer set search_path = public
as $$
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
    where ap.status in ('pendente', 'confirmado')
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
      'Amanhã tem horário marcado',
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
$$;

revoke execute on function public.enviar_lembretes() from public, anon;
grant execute on function public.enviar_lembretes() to authenticated;

-- 6. Depois do atendimento ----------------------------------------------
-- agradece e já planta a próxima: "costuma voltar em 30 dias"
create or replace function public.agradecer_e_semear()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  prof public.professionals%rowtype;
  dias integer;
  volta date;
  aceita boolean;
  nome_servico text;
begin
  if new.status <> 'concluido' or old.status = 'concluido' then
    return new;
  end if;

  if new.client_id is null then
    return new;
  end if;

  select * into prof from public.professionals where id = new.professional_id;
  if not found or not prof.followup_active then
    return new;
  end if;

  select p.accepts_reminders into aceita from public.profiles p where p.id = new.client_id;
  if not coalesce(aceita, false) then
    return new;
  end if;

  select s.return_days, coalesce(new.service_name, s.name)
    into dias, nome_servico
  from public.services s where s.id = new.service_id;

  nome_servico := coalesce(nome_servico, new.service_name, 'seu atendimento');

  if dias is null then
    perform public.notificar(
      new.client_id,
      'pos_atendimento',
      'Obrigada pela visita',
      'Esperamos você de novo com a ' || prof.name || '.',
      '/p/' || prof.slug,
      jsonb_build_object('appointment_id', new.id)
    );
  else
    volta := new.date + dias;
    perform public.notificar(
      new.client_id,
      'pos_atendimento',
      'Obrigada pela visita',
      lower(nome_servico) || ' costuma pedir retoque em ' || dias
        || ' dias — por volta de ' || to_char(volta, 'DD/MM')
        || '. Quer já deixar marcado?',
      '/p/' || prof.slug,
      jsonb_build_object('appointment_id', new.id, 'volta_em', volta)
    );
  end if;

  insert into public.client_nudges
    (professional_id, client_id, kind, appointment_id, service_id)
  values (new.professional_id, new.client_id, 'pos_atendimento', new.id, new.service_id);

  return new;
end;
$$;

revoke execute on function public.agradecer_e_semear() from public, anon, authenticated;

drop trigger if exists ao_concluir_agradecer on public.appointments;
create trigger ao_concluir_agradecer
  after update on public.appointments
  for each row execute function public.agradecer_e_semear();

-- 7. Quem sumiu ----------------------------------------------------------
-- A pergunta que a profissional não consegue responder de cabeça:
-- quem já passou do tempo de voltar e não tem nada marcado?
create or replace function public.clientes_para_retorno(
  prof uuid default public.my_professional_id()
)
returns table (
  client_id uuid,
  nome text,
  telefone text,
  ultima_visita date,
  dias_sem_vir integer,
  service_id uuid,
  servico text,
  voltaria_em date,
  total_visitas integer,
  pode_chamar boolean
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  hoje date := public.agora_local()::date;
begin
  if prof is null then
    raise exception 'Informe a profissional';
  end if;

  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;

  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver esta lista';
  end if;

  return query
  with ultimas as (
    select distinct on (a.client_id)
           a.client_id, a.date, a.service_id
    from public.appointments a
    where a.professional_id = prof
      and a.status = 'concluido'
      and a.client_id is not null
    order by a.client_id, a.date desc, a.start_time desc
  ),
  contagem as (
    select a.client_id, count(*)::integer as visitas
    from public.appointments a
    where a.professional_id = prof and a.status = 'concluido'
    group by a.client_id
  )
  select u.client_id,
         c.full_name,
         c.phone,
         u.date,
         (hoje - u.date)::integer,
         u.service_id,
         s.name,
         (u.date + coalesce(s.return_days, p.winback_after_days))::date,
         coalesce(n.visitas, 0),
         -- pode chamar: aceita avisos e não foi chamada no descanso
         c.accepts_reminders
           and not exists (
             select 1 from public.client_nudges cn
             where cn.professional_id = prof
               and cn.client_id = u.client_id
               and cn.kind = 'retorno'
               and cn.created_at
                   > now() - make_interval(days => p.winback_cooldown_days)
           )
  from ultimas u
  join public.profiles c on c.id = u.client_id
  left join public.services s on s.id = u.service_id
  left join contagem n on n.client_id = u.client_id
  where hoje >= u.date + coalesce(s.return_days, p.winback_after_days)
    -- quem já tem hora marcada não sumiu
    and not exists (
      select 1 from public.appointments f
      where f.professional_id = prof
        and f.client_id = u.client_id
        and f.date >= hoje
        and f.status in ('pendente', 'confirmado')
    )
  order by (hoje - u.date) desc;
end;
$$;

revoke execute on function public.clientes_para_retorno(uuid) from public, anon;
grant execute on function public.clientes_para_retorno(uuid) to authenticated;

-- 8. Chamar de volta -----------------------------------------------------
create or replace function public.chamar_de_volta(
  cliente uuid,
  prof uuid default public.my_professional_id(),
  recado text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  aceita boolean;
  ultima date;
  texto text;
  aviso_id uuid;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;

  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão';
  end if;

  select accepts_reminders into aceita from public.profiles where id = cliente;
  if aceita is null then
    raise exception 'Cliente não encontrada';
  end if;
  if not aceita then
    raise exception 'Esta cliente desligou os avisos';
  end if;

  if exists (
    select 1 from public.client_nudges cn
    where cn.professional_id = prof
      and cn.client_id = cliente
      and cn.kind = 'retorno'
      and cn.created_at > now() - make_interval(days => p.winback_cooldown_days)
  ) then
    raise exception 'Esta cliente já foi chamada há pouco tempo';
  end if;

  select max(a.date) into ultima
  from public.appointments a
  where a.professional_id = prof and a.client_id = cliente and a.status = 'concluido';

  texto := coalesce(
    nullif(btrim(recado), ''),
    'Faz ' || (public.agora_local()::date - ultima)
      || ' dias desde a sua última vez. A agenda da '
      || p.name || ' está aberta — dá uma olhada nos horários.'
  );

  aviso_id := public.notificar(
    cliente,
    'convite_retorno',
    'A ' || p.name || ' guardou um horário para você',
    texto,
    '/p/' || p.slug,
    jsonb_build_object('professional_id', prof)
  );

  insert into public.client_nudges (professional_id, client_id, kind)
  values (prof, cliente, 'retorno');

  return aviso_id;
end;
$$;

revoke execute on function public.chamar_de_volta(uuid, uuid, text) from public, anon;
grant execute on function public.chamar_de_volta(uuid, uuid, text) to authenticated;

-- Um toque para a lista inteira; pula quem está em descanso
create or replace function public.chamar_todas_de_volta(
  prof uuid default public.my_professional_id(),
  limite integer default 30
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  c record;
  n integer := 0;
begin
  for c in
    select client_id from public.clientes_para_retorno(prof)
    where pode_chamar
    limit greatest(1, least(coalesce(limite, 30), 100))
  loop
    begin
      perform public.chamar_de_volta(c.client_id, prof);
      n := n + 1;
    exception when others then
      -- uma cliente que não pôde ser chamada não derruba as outras
      null;
    end;
  end loop;
  return n;
end;
$$;

revoke execute on function public.chamar_todas_de_volta(uuid, integer) from public, anon;
grant execute on function public.chamar_todas_de_volta(uuid, integer) to authenticated;

-- 9. Ajustes da profissional --------------------------------------------
create or replace function public.config_retorno(
  prof uuid default public.my_professional_id()
)
returns table (
  reminder_hours_before integer,
  followup_active boolean,
  winback_after_days integer,
  winback_cooldown_days integer
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão';
  end if;

  return query select p.reminder_hours_before, p.followup_active,
                      p.winback_after_days, p.winback_cooldown_days;
end;
$$;

revoke execute on function public.config_retorno(uuid) from public, anon;
grant execute on function public.config_retorno(uuid) to authenticated;


-- 10. A profissional mexe na própria ficha, mas não no vínculo --------
-- A política já deixava ela editar a linha dela (foto, bio, os ajustes
-- acima). Só que "a linha dela" incluía salon_id: dava para se mudar
-- de salão sozinha. Aqui esses dois campos só mudam por mão de admin.
-- SECURITY INVOKER de propósito: só assim current_user é 'authenticated'
-- num PATCH que vem da API e vira o dono da função quando a escrita
-- nasce dentro de uma função nossa (que já validou o que precisava).
create or replace function public.protege_vinculo_profissional()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
begin
  -- escrita nascida dentro de uma função do servidor passa direto
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.salon_id is distinct from old.salon_id
     or new.user_id is distinct from old.user_id then
    if not (public.is_admin_do_salao(old.salon_id)
            and public.is_admin_do_salao(new.salon_id)) then
      raise exception 'Só a administração do salão muda o vínculo da profissional';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.protege_vinculo_profissional()
  from public, anon, authenticated;

drop trigger if exists protege_vinculo on public.professionals;
create trigger protege_vinculo
  before update on public.professionals
  for each row execute function public.protege_vinculo_profissional();
