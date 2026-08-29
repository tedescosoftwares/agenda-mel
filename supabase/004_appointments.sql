-- =============================================================
-- Agenda Mel — 004: agendamentos + admin enxerga perfis
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 003).
-- =============================================================

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete restrict,
  date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'confirmado', 'cancelado', 'concluido')),
  notes text,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

-- Evita dois agendamentos no mesmo dia e horário (cancelados não contam)
create unique index if not exists appointments_slot_unique
  on public.appointments (date, start_time)
  where status <> 'cancelado';

alter table public.appointments enable row level security;

-- Cliente vê e cria os próprios agendamentos; admin vê e gerencia todos
drop policy if exists "ver agendamentos" on public.appointments;
create policy "ver agendamentos"
  on public.appointments for select
  to authenticated
  using (client_id = auth.uid() or public.is_admin());

drop policy if exists "criar agendamentos" on public.appointments;
create policy "criar agendamentos"
  on public.appointments for insert
  to authenticated
  with check (client_id = auth.uid() or public.is_admin());

drop policy if exists "alterar agendamentos" on public.appointments;
create policy "alterar agendamentos"
  on public.appointments for update
  to authenticated
  using (client_id = auth.uid() or public.is_admin());

drop policy if exists "admin exclui agendamentos" on public.appointments;
create policy "admin exclui agendamentos"
  on public.appointments for delete
  to authenticated
  using (public.is_admin());

-- Admin precisa ver os perfis das clientes (lista de clientes e agenda)
drop policy if exists "admin ve todos os perfis" on public.profiles;
create policy "admin ve todos os perfis"
  on public.profiles for select
  to authenticated
  using (public.is_admin());
