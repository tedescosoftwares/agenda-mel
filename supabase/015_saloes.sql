-- =============================================================
-- Agenda Mel — 015: camada de salão (o produto nasce marketplace)
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 014).
--
-- Até aqui existia UM salão implícito. A partir de agora cada
-- negócio é um salão com catálogo, equipe, horários e marca
-- próprios — e um admin não enxerga nem toca no salão de outro.
-- O pagamento entra depois; a fronteira precisa existir antes.
-- =============================================================

-- 1. O salão -------------------------------------------------------------
create table if not exists public.salons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  owner_id uuid references public.profiles (id) on delete set null,
  phone text,
  city text,
  address text,
  logo_url text,
  -- cor da marca: base do white label
  brand_color text default '#c98a8a',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists salons_owner_idx on public.salons (owner_id);

-- 2. Quem pertence a qual salão ------------------------------------------
-- (uma pessoa pode administrar mais de um salão; a cliente não
--  pertence a salão nenhum — ela circula livre pelo marketplace)
create table if not exists public.salon_members (
  salon_id uuid not null references public.salons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  papel text not null default 'admin' check (papel in ('admin', 'profissional')),
  created_at timestamptz not null default now(),
  primary key (salon_id, user_id)
);

create index if not exists salon_members_user_idx on public.salon_members (user_id);

-- 3. Tudo que é do negócio ganha dono ------------------------------------
alter table public.services add column if not exists salon_id uuid references public.salons (id) on delete cascade;
alter table public.professionals add column if not exists salon_id uuid references public.salons (id) on delete cascade;
alter table public.business_hours add column if not exists salon_id uuid references public.salons (id) on delete cascade;
alter table public.appointments add column if not exists salon_id uuid references public.salons (id) on delete restrict;

-- 4. Migração: o que existe hoje vira o primeiro salão -------------------
do $$
declare
  salao_id uuid;
  dono uuid;
begin
  if exists (select 1 from public.salons) then
    select id into salao_id from public.salons order by created_at limit 1;
  else
    select id into dono from public.profiles where role = 'admin' order by created_at limit 1;
    insert into public.salons (name, slug, owner_id)
    values ('Agenda Mel', 'agenda-mel', dono)
    returning id into salao_id;

    if dono is not null then
      insert into public.salon_members (salon_id, user_id, papel)
      values (salao_id, dono, 'admin')
      on conflict do nothing;
    end if;
  end if;

  update public.services set salon_id = salao_id where salon_id is null;
  update public.professionals set salon_id = salao_id where salon_id is null;
  update public.business_hours set salon_id = salao_id where salon_id is null;
  update public.appointments a
  set salon_id = coalesce(
        (select p.salon_id from public.professionals p where p.id = a.professional_id),
        salao_id)
  where a.salon_id is null;

  -- profissionais que já têm login entram como membros do salão
  insert into public.salon_members (salon_id, user_id, papel)
  select p.salon_id, p.user_id, 'profissional'
  from public.professionals p
  where p.user_id is not null and p.salon_id is not null
  on conflict do nothing;
end;
$$;

-- horário padrão passa a ser por salão
alter table public.business_hours drop constraint if exists business_hours_pkey;
alter table public.business_hours add primary key (salon_id, weekday);

alter table public.services alter column salon_id set not null;
alter table public.professionals alter column salon_id set not null;
alter table public.appointments alter column salon_id set not null;

-- o link da profissional é único dentro do salão, não no mundo
alter table public.professionals drop constraint if exists professionals_slug_key;
create unique index if not exists professionals_slug_unico
  on public.professionals (slug);

-- 5. Quem manda em qual salão --------------------------------------------
create or replace function public.meus_saloes()
returns setof uuid
language sql
stable
security definer set search_path = public
as $$
  select salon_id from public.salon_members
  where user_id = auth.uid() and papel = 'admin'
  union
  select id from public.salons where owner_id = auth.uid();
$$;

create or replace function public.is_admin_do_salao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select salao is not null and exists (
    select 1 from public.meus_saloes() s where s = salao
  );
$$;

-- is_admin() continua existindo para o que é do próprio produto,
-- mas as políticas de dado passam a usar a versão com salão.
grant execute on function public.meus_saloes() to authenticated;
grant execute on function public.is_admin_do_salao(uuid) to authenticated;

-- 6. O salão passa a delimitar as permissões -----------------------------
alter table public.salons enable row level security;
alter table public.salon_members enable row level security;

-- a vitrine do marketplace é pública
drop policy if exists "ver saloes" on public.salons;
create policy "ver saloes"
  on public.salons for select
  to anon, authenticated
  using (active or public.is_admin_do_salao(id));

drop policy if exists "dona edita o salao" on public.salons;
create policy "dona edita o salao"
  on public.salons for update
  to authenticated
  using (public.is_admin_do_salao(id))
  with check (public.is_admin_do_salao(id));

-- qualquer pessoa logada pode abrir o próprio salão (entrada do marketplace)
drop policy if exists "abrir meu salao" on public.salons;
create policy "abrir meu salao"
  on public.salons for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "ver membros do salao" on public.salon_members;
create policy "ver membros do salao"
  on public.salon_members for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin_do_salao(salon_id));

drop policy if exists "admin gerencia membros" on public.salon_members;
create policy "admin gerencia membros"
  on public.salon_members for all
  to authenticated
  using (public.is_admin_do_salao(salon_id))
  with check (public.is_admin_do_salao(salon_id));

-- serviços
drop policy if exists "admin cria servicos" on public.services;
create policy "admin cria servicos"
  on public.services for insert
  to authenticated
  with check (public.is_admin_do_salao(salon_id));

drop policy if exists "admin edita servicos" on public.services;
create policy "admin edita servicos"
  on public.services for update
  to authenticated
  using (public.is_admin_do_salao(salon_id))
  with check (public.is_admin_do_salao(salon_id));

drop policy if exists "admin exclui servicos" on public.services;
create policy "admin exclui servicos"
  on public.services for delete
  to authenticated
  using (public.is_admin_do_salao(salon_id));

drop policy if exists "ver servicos" on public.services;
create policy "ver servicos"
  on public.services for select
  to anon, authenticated
  using (active or public.is_admin_do_salao(salon_id));

-- profissionais
drop policy if exists "admin cria profissionais" on public.professionals;
create policy "admin cria profissionais"
  on public.professionals for insert
  to authenticated
  with check (public.is_admin_do_salao(salon_id));

drop policy if exists "admin ou dona edita profissional" on public.professionals;
create policy "admin ou dona edita profissional"
  on public.professionals for update
  to authenticated
  using (public.is_admin_do_salao(salon_id) or user_id = auth.uid())
  with check (public.is_admin_do_salao(salon_id) or user_id = auth.uid());

drop policy if exists "admin exclui profissionais" on public.professionals;
create policy "admin exclui profissionais"
  on public.professionals for delete
  to authenticated
  using (public.is_admin_do_salao(salon_id));

drop policy if exists "ver profissionais" on public.professionals;
create policy "ver profissionais"
  on public.professionals for select
  to anon, authenticated
  using (active or public.is_admin_do_salao(salon_id) or user_id = auth.uid());

-- horário padrão do salão
drop policy if exists "ver horarios" on public.business_hours;
create policy "ver horarios"
  on public.business_hours for select
  to anon, authenticated
  using (true);

drop policy if exists "admin altera horarios" on public.business_hours;
create policy "admin altera horarios"
  on public.business_hours for update
  to authenticated
  using (public.is_admin_do_salao(salon_id))
  with check (public.is_admin_do_salao(salon_id));

drop policy if exists "admin cria horarios" on public.business_hours;
create policy "admin cria horarios"
  on public.business_hours for insert
  to authenticated
  with check (public.is_admin_do_salao(salon_id));

-- agendamentos
drop policy if exists "ver agendamentos" on public.appointments;
create policy "ver agendamentos"
  on public.appointments for select
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin_do_salao(salon_id)
    or public.is_professional(professional_id)
  );

drop policy if exists "alterar agendamentos" on public.appointments;
create policy "alterar agendamentos"
  on public.appointments for update
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin_do_salao(salon_id)
    or public.is_professional(professional_id)
  )
  with check (
    client_id = auth.uid()
    or public.is_admin_do_salao(salon_id)
    or public.is_professional(professional_id)
  );

drop policy if exists "admin exclui agendamentos" on public.appointments;
create policy "admin exclui agendamentos"
  on public.appointments for delete
  to authenticated
  using (public.is_admin_do_salao(salon_id));

-- o salão do agendamento vem sempre da profissional
create or replace function public.preenche_salao_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  select salon_id into new.salon_id
  from public.professionals where id = new.professional_id;
  if new.salon_id is null then
    raise exception 'Profissional sem salão';
  end if;
  return new;
end;
$$;

revoke execute on function public.preenche_salao_agendamento() from public, anon, authenticated;

drop trigger if exists on_preenche_salao on public.appointments;
create trigger on_preenche_salao
  before insert on public.appointments
  for each row execute function public.preenche_salao_agendamento();

-- perfis: o admin enxerga quem agenda no salão dele, e mais ninguém
drop policy if exists "admin ve todos os perfis" on public.profiles;
create policy "admin ve clientes do salao"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.client_id = profiles.id
        and public.is_admin_do_salao(a.salon_id)
    )
    or exists (
      select 1 from public.salon_members m
      where m.user_id = profiles.id
        and public.is_admin_do_salao(m.salon_id)
    )
  );

-- 7. Profissional nova herda o horário do salão dela ---------------------
create or replace function public.seed_professional_hours()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.professional_hours (professional_id, weekday, open, start_time, end_time)
  select new.id, b.weekday, b.open, b.start_time, b.end_time
  from public.business_hours b
  where b.salon_id = new.salon_id
  on conflict do nothing;

  insert into public.professional_hours (professional_id, weekday, open)
  select new.id, d, d between 1 and 5
  from generate_series(0, 6) as d
  on conflict do nothing;

  return new;
end;
$$;

revoke execute on function public.seed_professional_hours() from public, anon, authenticated;

-- 8. Abrir um salão novo (entrada do marketplace) ------------------------
create or replace function public.abrir_salao(
  nome text,
  endereco_slug text,
  cidade text default null,
  telefone text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo_id uuid;
  slug_limpo text;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para abrir um salão';
  end if;

  slug_limpo := lower(regexp_replace(coalesce(endereco_slug, nome), '[^a-zA-Z0-9]+', '-', 'g'));
  slug_limpo := trim(both '-' from slug_limpo);
  if slug_limpo = '' then
    raise exception 'Escolha um endereço com letras ou números';
  end if;

  insert into public.salons (name, slug, owner_id, city, phone)
  values (nome, slug_limpo, auth.uid(), cidade, telefone)
  returning id into novo_id;

  insert into public.salon_members (salon_id, user_id, papel)
  values (novo_id, auth.uid(), 'admin');

  -- horário padrão: seg a sex, 9h às 18h
  insert into public.business_hours (salon_id, weekday, open)
  select novo_id, d, d between 1 and 5
  from generate_series(0, 6) as d
  on conflict do nothing;

  -- quem abre salão vira admin
  update public.profiles set role = 'admin' where id = auth.uid() and role = 'cliente';

  return novo_id;
end;
$$;

grant execute on function public.abrir_salao(text, text, text, text) to authenticated;
