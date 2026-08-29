-- =============================================================
-- Agenda Mel — 009: caixa de avisos no app (fundação)
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 008).
--
-- É a base de "adiantar a agenda", "lista de espera" e de todo o
-- remarketing: nada avisa ninguém sem passar por aqui.
-- =============================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  -- para onde o toque no aviso leva dentro do app
  action_url text,
  -- carga livre: id do agendamento, da vaga, do crédito…
  data jsonb not null default '{}',
  read_at timestamptz,
  -- avisos com prazo (vaga liberada) somem sozinhos da caixa
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Cada pessoa vê apenas os próprios avisos
drop policy if exists "ver meus avisos" on public.notifications;
create policy "ver meus avisos"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

-- Marcar como lido é a única edição permitida
drop policy if exists "marcar aviso como lido" on public.notifications;
create policy "marcar aviso como lido"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Ninguém escreve avisos direto pela API: só as funções do servidor
revoke insert, delete on public.notifications from authenticated, anon;

-- Função interna usada pelas demais features para avisar alguém
create or replace function public.notificar(
  destinatario uuid,
  tipo text,
  titulo text,
  texto text default null,
  url text default null,
  carga jsonb default '{}',
  vence_em timestamptz default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo_id uuid;
begin
  insert into public.notifications (user_id, kind, title, body, action_url, data, expires_at)
  values (destinatario, tipo, titulo, texto, url, coalesce(carga, '{}'::jsonb), vence_em)
  returning id into novo_id;
  return novo_id;
end;
$$;

-- Marcar todos como lidos de uma vez
create or replace function public.marcar_avisos_lidos()
returns void
language sql
security definer set search_path = public
as $$
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;
$$;

grant execute on function public.marcar_avisos_lidos() to authenticated;

-- Avisos chegam na hora, sem precisar recarregar a tela
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
end;
$$;
