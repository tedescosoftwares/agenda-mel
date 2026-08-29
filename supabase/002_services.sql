-- =============================================================
-- Agenda Mel — 002: cadastro de serviços
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 001_schema.sql).
-- =============================================================

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  duration_minutes integer not null default 60 check (duration_minutes > 0),
  price numeric(10, 2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.services enable row level security;

-- Função auxiliar: o usuário logado é admin?
-- (security definer para não esbarrar na RLS da tabela profiles)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Clientes logadas veem apenas serviços ativos; admin vê todos
drop policy if exists "ver servicos" on public.services;
create policy "ver servicos"
  on public.services for select
  to authenticated
  using (active or public.is_admin());

drop policy if exists "admin cria servicos" on public.services;
create policy "admin cria servicos"
  on public.services for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin edita servicos" on public.services;
create policy "admin edita servicos"
  on public.services for update
  to authenticated
  using (public.is_admin());

drop policy if exists "admin exclui servicos" on public.services;
create policy "admin exclui servicos"
  on public.services for delete
  to authenticated
  using (public.is_admin());
