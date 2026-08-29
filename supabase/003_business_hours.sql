-- =============================================================
-- Agenda Mel — 003: horários de atendimento
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 002_services.sql).
-- =============================================================

-- Um registro por dia da semana (0 = domingo … 6 = sábado)
create table if not exists public.business_hours (
  weekday smallint primary key check (weekday between 0 and 6),
  open boolean not null default false,
  start_time time not null default '09:00',
  end_time time not null default '18:00',
  check (end_time > start_time)
);

-- Semente: cria os 7 dias (seg–sex abertos por padrão)
insert into public.business_hours (weekday, open)
values
  (0, false),
  (1, true),
  (2, true),
  (3, true),
  (4, true),
  (5, true),
  (6, false)
on conflict (weekday) do nothing;

alter table public.business_hours enable row level security;

-- Qualquer pessoa logada pode consultar (a cliente precisa ver os
-- horários disponíveis na hora de agendar); só admin altera
drop policy if exists "ver horarios" on public.business_hours;
create policy "ver horarios"
  on public.business_hours for select
  to authenticated
  using (true);

drop policy if exists "admin altera horarios" on public.business_hours;
create policy "admin altera horarios"
  on public.business_hours for update
  to authenticated
  using (public.is_admin());
