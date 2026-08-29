-- =============================================================
-- Agenda Mel — schema inicial (login + perfis com papel)
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- =============================================================

-- Tabela de perfis: 1 linha por usuário do Auth
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'cliente' check (role in ('cliente', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cada usuária vê e edita apenas o próprio perfil
create policy "ver o proprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "editar o proprio perfil"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Impede que uma cliente mude o próprio papel para admin pela API:
-- o update fica permitido apenas nas colunas de nome e telefone.
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- Cria o perfil automaticamente quando alguém se cadastra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================
-- Para tornar uma conta ADMIN, depois de se cadastrar pelo app,
-- rode o comando abaixo trocando o e-mail:
--
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'seu-email@exemplo.com');
-- =============================================================
