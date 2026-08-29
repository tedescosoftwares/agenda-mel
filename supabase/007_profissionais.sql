-- =============================================================
-- Agenda Mel — 007: profissionais, agenda própria e link público
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 006).
--
-- A partir daqui o app é multi-profissional:
--   • o salão (admin) mantém o catálogo único de serviços
--   • cada profissional escolhe quais serviços atende
--   • cada profissional tem os próprios horários de atendimento
--   • cada profissional tem um link público /p/<slug>
-- =============================================================

-- 1. Papel novo: profissional -------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('cliente', 'profissional', 'admin'));

-- 2. Profissionais -------------------------------------------------------
create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  -- conta de login da profissional (pode ser preenchida depois)
  user_id uuid unique references public.profiles (id) on delete set null,
  name text not null,
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  bio text,
  photo_url text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Quais serviços do catálogo cada profissional atende
create table if not exists public.professional_services (
  professional_id uuid not null references public.professionals (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (professional_id, service_id)
);

-- Horários de atendimento por profissional (0 = domingo … 6 = sábado)
create table if not exists public.professional_hours (
  professional_id uuid not null references public.professionals (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  open boolean not null default false,
  start_time time not null default '09:00',
  end_time time not null default '18:00',
  primary key (professional_id, weekday),
  check (end_time > start_time)
);

-- Toda profissional nova nasce com os 7 dias, copiando o padrão do salão
create or replace function public.seed_professional_hours()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.professional_hours (professional_id, weekday, open, start_time, end_time)
  select new.id, b.weekday, b.open, b.start_time, b.end_time
  from public.business_hours b
  on conflict do nothing;

  -- se o salão ainda não tem horários configurados, cria seg–sex 09h–18h
  insert into public.professional_hours (professional_id, weekday, open)
  select new.id, d, d between 1 and 5
  from generate_series(0, 6) as d
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_professional_created on public.professionals;
create trigger on_professional_created
  after insert on public.professionals
  for each row execute function public.seed_professional_hours();

-- 3. Agendamentos passam a ser por profissional --------------------------
alter table public.appointments
  add column if not exists professional_id uuid references public.professionals (id) on delete restrict;

-- o conflito de horário agora é por profissional, não global
drop index if exists appointments_slot_unique;
create unique index if not exists appointments_prof_slot_unique
  on public.appointments (professional_id, date, start_time)
  where status <> 'cancelado';

-- 4. Funções auxiliares ---------------------------------------------------
-- a pessoa logada é a dona desta ficha de profissional?
create or replace function public.is_professional(prof_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.professionals
    where id = prof_id and user_id = auth.uid()
  );
$$;

-- ficha da profissional logada (null se não for profissional)
create or replace function public.my_professional_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select id from public.professionals where user_id = auth.uid() limit 1;
$$;

-- Horários ocupados de uma profissional num dia — só início e fim,
-- sem expor dados de nenhuma cliente. Aberta ao público (o link da
-- profissional mostra a grade antes de qualquer login).
drop function if exists public.get_busy_slots(date);
create or replace function public.get_busy_slots(dia date, prof uuid)
returns table (start_time time, end_time time)
language sql
stable
security definer set search_path = public
as $$
  select a.start_time, a.end_time
  from public.appointments a
  where a.date = dia
    and a.professional_id = prof
    and a.status <> 'cancelado';
$$;

grant execute on function public.get_busy_slots(date, uuid) to anon, authenticated;
grant execute on function public.my_professional_id() to authenticated;

-- 5. Permissões (RLS) ----------------------------------------------------
alter table public.professionals enable row level security;
alter table public.professional_services enable row level security;
alter table public.professional_hours enable row level security;

-- O link público precisa funcionar sem login: leitura liberada
drop policy if exists "ver profissionais" on public.professionals;
create policy "ver profissionais"
  on public.professionals for select
  to anon, authenticated
  using (active or public.is_admin() or user_id = auth.uid());

drop policy if exists "admin cria profissionais" on public.professionals;
create policy "admin cria profissionais"
  on public.professionals for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin ou dona edita profissional" on public.professionals;
create policy "admin ou dona edita profissional"
  on public.professionals for update
  to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists "admin exclui profissionais" on public.professionals;
create policy "admin exclui profissionais"
  on public.professionals for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "ver servicos da profissional" on public.professional_services;
create policy "ver servicos da profissional"
  on public.professional_services for select
  to anon, authenticated
  using (true);

drop policy if exists "admin ou dona define servicos" on public.professional_services;
create policy "admin ou dona define servicos"
  on public.professional_services for insert
  to authenticated
  with check (public.is_admin() or public.is_professional(professional_id));

drop policy if exists "admin ou dona remove servicos" on public.professional_services;
create policy "admin ou dona remove servicos"
  on public.professional_services for delete
  to authenticated
  using (public.is_admin() or public.is_professional(professional_id));

drop policy if exists "ver horarios da profissional" on public.professional_hours;
create policy "ver horarios da profissional"
  on public.professional_hours for select
  to anon, authenticated
  using (true);

drop policy if exists "admin ou dona altera horarios" on public.professional_hours;
create policy "admin ou dona altera horarios"
  on public.professional_hours for update
  to authenticated
  using (public.is_admin() or public.is_professional(professional_id));

-- Catálogo de serviços: visível também para quem não está logado
drop policy if exists "ver servicos" on public.services;
create policy "ver servicos"
  on public.services for select
  to anon, authenticated
  using (active or public.is_admin());

-- Agendamentos: a profissional enxerga e gerencia os dela
drop policy if exists "ver agendamentos" on public.appointments;
create policy "ver agendamentos"
  on public.appointments for select
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin()
    or public.is_professional(professional_id)
  );

drop policy if exists "alterar agendamentos" on public.appointments;
create policy "alterar agendamentos"
  on public.appointments for update
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin()
    or public.is_professional(professional_id)
  );

-- A profissional também precisa ver o perfil de quem agendou com ela
drop policy if exists "profissional ve clientes dela" on public.profiles;
create policy "profissional ve clientes dela"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.client_id = profiles.id
        and public.is_professional(a.professional_id)
    )
  );

-- =============================================================
-- Depois de rodar: cadastre as profissionais em Admin → Equipe.
-- Para ligar a conta de login de uma profissional à ficha dela,
-- peça que ela crie uma conta pelo app e rode:
--
-- update public.profiles set role = 'profissional'
-- where id = (select id from auth.users where email = 'ela@exemplo.com');
--
-- update public.professionals set user_id =
--   (select id from auth.users where email = 'ela@exemplo.com')
-- where slug = 'slug-dela';
-- =============================================================
