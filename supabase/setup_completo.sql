-- =============================================================
--  AGENDA MEL — INSTALAÇÃO COMPLETA (arquivo único)
--
--  Cole ISTO INTEIRO no SQL Editor do Supabase e clique em Run.
--  Uma vez só. Não precisa rodar mais nada.
--
--  • Funciona em banco vazio E em banco que já tem parte das coisas.
--  • Pode rodar de novo quantas vezes quiser: nada é duplicado.
--  • No fim, cria três contas de teste (senha agendamel123):
--        admin@exemplo.com         → dona do salão
--        profissional@exemplo.com  → Ana Paula
--        cliente@exemplo.com       → Juliana
--    e um salão de exemplo com serviços, horários, agendamentos e
--    dois meses de histórico, para as telas de números e de
--    "quem sumiu" já nascerem com o que mostrar.
--
--  O WhatsApp nasce no canal MANUAL: o app escreve a mensagem e a
--  profissional envia com um toque, do WhatsApp dela. Não precisa
--  configurar nada para isso funcionar. Ligar um número que manda
--  sozinho é depois, e é trocar uma linha em whatsapp_channels.
--
--  Se der erro, me mande a mensagem inteira: cada bloco abaixo está
--  marcado com o nome do arquivo de origem, então dá para achar na hora.
-- =============================================================

-- =============================================================
-- >>> 001_schema.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 001: schema inicial (login + perfis com papel)
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
drop policy if exists "ver o proprio perfil" on public.profiles;
create policy "ver o proprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "editar o proprio perfil" on public.profiles;
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

-- =============================================================
-- >>> 002_services.sql
-- =============================================================

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

-- =============================================================
-- >>> 003_business_hours.sql
-- =============================================================

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

-- Semente: cria os 7 dias (seg–sex abertos por padrão).
-- Depois do 015 os horários passam a ser por salão, e quem cuida
-- do preenchimento é aquele arquivo — por isso a checagem aqui.
do $$
begin
  if exists (select 1 from public.business_hours) then
    return;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'business_hours'
      and column_name = 'salon_id'
  ) then
    return;
  end if;

  insert into public.business_hours (weekday, open)
  values (0, false), (1, true), (2, true), (3, true),
         (4, true), (5, true), (6, false);
end;
$$;

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

-- =============================================================
-- >>> 004_appointments.sql
-- =============================================================

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

-- =============================================================
-- >>> 005_service_images_e_slots.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 005: imagens dos serviços + horários ocupados
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 004).
-- =============================================================

-- Até 3 imagens por serviço (URLs públicas do Storage)
alter table public.services
  add column if not exists images text[] not null default '{}';

-- Bucket público para as fotos dos serviços
insert into storage.buckets (id, name, public)
values ('service-images', 'service-images', true)
on conflict (id) do nothing;

-- Qualquer pessoa vê as imagens; só admin envia/remove
drop policy if exists "imagens de servicos publicas" on storage.objects;
create policy "imagens de servicos publicas"
  on storage.objects for select
  using (bucket_id = 'service-images');

drop policy if exists "admin envia imagens de servicos" on storage.objects;
create policy "admin envia imagens de servicos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'service-images' and public.is_admin());

drop policy if exists "admin atualiza imagens de servicos" on storage.objects;
create policy "admin atualiza imagens de servicos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'service-images' and public.is_admin());

drop policy if exists "admin remove imagens de servicos" on storage.objects;
create policy "admin remove imagens de servicos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'service-images' and public.is_admin());

-- Horários ocupados de um dia, sem expor dados de outras clientes.
-- (a cliente só enxerga os próprios agendamentos pela RLS; esta função
-- devolve apenas início/fim dos horários tomados, para montar a grade)
create or replace function public.get_busy_slots(dia date)
returns table (start_time time, end_time time)
language sql
stable
security definer set search_path = public
as $$
  select a.start_time, a.end_time
  from public.appointments a
  where a.date = dia and a.status <> 'cancelado';
$$;

grant execute on function public.get_busy_slots(date) to authenticated;

-- =============================================================
-- >>> 006_combos.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 006: combos de serviços
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 005).
-- =============================================================

-- Um combo é um serviço que agrupa outros: a duração é a soma das
-- durações dos serviços incluídos (exibida ao cliente como tempo
-- médio, não como tempo exato) e o preço é definido pelo admin.
alter table public.services
  add column if not exists is_combo boolean not null default false;

alter table public.services
  add column if not exists combo_service_ids uuid[] not null default '{}';

-- =============================================================
-- >>> 007_profissionais.sql
-- =============================================================

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

-- =============================================================
-- >>> 008_foto_profissional.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 008: foto da profissional
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 007).
--
-- A coluna professionals.photo_url já existe desde o 007; aqui
-- criamos o lugar onde a imagem fica guardada.
-- =============================================================

insert into storage.buckets (id, name, public)
values ('professional-photos', 'professional-photos', true)
on conflict (id) do nothing;

-- A foto aparece no link público, então a leitura é aberta
drop policy if exists "fotos de profissionais publicas" on storage.objects;
create policy "fotos de profissionais publicas"
  on storage.objects for select
  using (bucket_id = 'professional-photos');

-- Envio/remoção: o salão ou a própria profissional
drop policy if exists "equipe envia foto de profissional" on storage.objects;
create policy "equipe envia foto de profissional"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'professional-photos'
    and (public.is_admin() or public.my_professional_id() is not null)
  );

drop policy if exists "equipe atualiza foto de profissional" on storage.objects;
create policy "equipe atualiza foto de profissional"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'professional-photos'
    and (public.is_admin() or public.my_professional_id() is not null)
  );

drop policy if exists "equipe remove foto de profissional" on storage.objects;
create policy "equipe remove foto de profissional"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'professional-photos'
    and (public.is_admin() or public.my_professional_id() is not null)
  );

-- =============================================================
-- >>> 009_notificacoes.sql
-- =============================================================

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

-- =============================================================
-- >>> 010_adiantar_agenda.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 010: adiantar a agenda
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 009).
--
-- A profissional terminou antes e quer puxar os próximos horários.
-- REGRA CENTRAL: nunca se adianta à força. O app cria um CONVITE com
-- prazo; a cliente aceita ou recusa. Sem resposta, nada muda.
-- =============================================================

-- O app é usado no Brasil; a agenda é sempre lida no horário local.
create or replace function public.agora_local()
returns timestamp
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::timestamp;
$$;

create table if not exists public.appointment_offers (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  -- para onde estamos propondo mover
  proposed_date date not null,
  proposed_start_time time not null,
  proposed_end_time time not null,
  -- de onde saiu (permite desfazer e auditar)
  previous_date date not null,
  previous_start_time time not null,
  previous_end_time time not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'aceita', 'recusada', 'expirada', 'cancelada')),
  expires_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (proposed_end_time > proposed_start_time)
);

-- No máximo um convite aberto por agendamento
create unique index if not exists appointment_offers_um_pendente
  on public.appointment_offers (appointment_id)
  where status = 'pendente';

create index if not exists appointment_offers_appt_idx
  on public.appointment_offers (appointment_id, created_at desc);

alter table public.appointment_offers enable row level security;

-- Cliente vê os convites dos agendamentos dela; profissional, os dela
drop policy if exists "ver convites de antecipacao" on public.appointment_offers;
create policy "ver convites de antecipacao"
  on public.appointment_offers for select
  to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_offers.appointment_id
        and (
          a.client_id = auth.uid()
          or public.is_admin()
          or public.is_professional(a.professional_id)
        )
    )
  );

-- Escrita só pelas funções abaixo
revoke insert, update, delete on public.appointment_offers from authenticated, anon;

-- -------------------------------------------------------------
-- Quanto dá para adiantar: o horário mais cedo possível para um
-- agendamento, sem colidir com o que já está marcado nem cair no
-- passado. Devolve null quando não há espaço.
-- -------------------------------------------------------------
create or replace function public.horario_mais_cedo_possivel(appt_id uuid)
returns time
language plpgsql
stable
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  duracao interval;
  limite_anterior time;
  expediente_inicio time;
  candidato time;
  minutos integer;
  agora timestamp := public.agora_local();
begin
  select * into appt from public.appointments where id = appt_id;
  if not found or appt.status in ('cancelado', 'concluido') then
    return null;
  end if;

  duracao := appt.end_time - appt.start_time;

  -- não adiantamos para antes da abertura do expediente dela
  select h.start_time into expediente_inicio
  from public.professional_hours h
  where h.professional_id = appt.professional_id
    and h.weekday = extract(dow from appt.date)
    and h.open;
  if expediente_inicio is null then
    return null;
  end if;

  -- nem para cima do atendimento anterior do mesmo dia
  select max(a.end_time) into limite_anterior
  from public.appointments a
  where a.professional_id = appt.professional_id
    and a.date = appt.date
    and a.id <> appt.id
    and a.status <> 'cancelado'
    and a.end_time <= appt.start_time;

  candidato := greatest(expediente_inicio, coalesce(limite_anterior, expediente_inicio));

  -- se é hoje, nunca para antes de agora
  if appt.date = agora::date then
    candidato := greatest(candidato, (agora + interval '5 minutes')::time);
  end if;

  -- arredonda para os 5 minutos seguintes, para não propor 13:47
  minutos := extract(hour from candidato)::int * 60 + extract(minute from candidato)::int;
  minutos := (ceil(minutos / 5.0) * 5)::int;
  if minutos >= 24 * 60 then
    return null;
  end if;
  candidato := make_time(minutos / 60, minutos % 60, 0);

  if candidato >= appt.start_time then
    return null; -- não há nada a adiantar
  end if;

  -- o horário proposto ainda precisa caber antes do próximo atendimento
  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = appt.date
      and a.id <> appt.id
      and a.status <> 'cancelado'
      and candidato < a.end_time
      and (candidato + duracao) > a.start_time
  ) then
    return null;
  end if;

  return candidato;
end;
$$;

-- -------------------------------------------------------------
-- A profissional convida a cliente a adiantar
-- -------------------------------------------------------------
create or replace function public.propor_antecipacao(
  appt_id uuid,
  novo_inicio time,
  minutos_para_responder integer default 15
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  duracao interval;
  novo_fim time;
  prof_nome text;
  serv_nome text;
  oferta_id uuid;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin() or public.is_professional(appt.professional_id)) then
    raise exception 'Só a profissional do atendimento pode propor adiantar';
  end if;

  if appt.status in ('cancelado', 'concluido') then
    raise exception 'Este agendamento não está mais aberto';
  end if;

  if novo_inicio >= appt.start_time then
    raise exception 'O novo horário precisa ser mais cedo que o atual';
  end if;

  if minutos_para_responder < 5 or minutos_para_responder > 240 then
    raise exception 'O prazo de resposta deve ficar entre 5 e 240 minutos';
  end if;

  duracao := appt.end_time - appt.start_time;
  novo_fim := novo_inicio + duracao;

  -- o horário proposto precisa estar livre na agenda dela
  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = appt.date
      and a.id <> appt.id
      and a.status <> 'cancelado'
      and novo_inicio < a.end_time
      and novo_fim > a.start_time
  ) then
    raise exception 'Esse horário conflita com outro atendimento';
  end if;

  -- fecha convite anterior ainda aberto para este agendamento
  update public.appointment_offers
  set status = 'cancelada', responded_at = now()
  where appointment_id = appt_id and status = 'pendente';

  insert into public.appointment_offers (
    appointment_id, proposed_date, proposed_start_time, proposed_end_time,
    previous_date, previous_start_time, previous_end_time,
    expires_at, created_by
  ) values (
    appt_id, appt.date, novo_inicio, novo_fim,
    appt.date, appt.start_time, appt.end_time,
    now() + make_interval(mins => minutos_para_responder), auth.uid()
  )
  returning id into oferta_id;

  select p.name into prof_nome from public.professionals p where p.id = appt.professional_id;
  select s.name into serv_nome from public.services s where s.id = appt.service_id;

  perform public.notificar(
    appt.client_id,
    'agenda_adiantada',
    'Dá para adiantar seu horário?',
    format('%s pode te atender às %s em vez de %s (%s). Responda em até %s minutos.',
           coalesce(prof_nome, 'Sua profissional'),
           to_char(novo_inicio, 'HH24:MI'),
           to_char(appt.start_time, 'HH24:MI'),
           coalesce(serv_nome, 'seu serviço'),
           minutos_para_responder),
    '/',
    jsonb_build_object('offer_id', oferta_id, 'appointment_id', appt_id),
    now() + make_interval(mins => minutos_para_responder)
  );

  return oferta_id;
end;
$$;

-- -------------------------------------------------------------
-- A cliente responde
-- -------------------------------------------------------------
create or replace function public.responder_antecipacao(
  oferta_id uuid,
  aceitar boolean
)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.appointment_offers%rowtype;
  appt public.appointments%rowtype;
  cliente_nome text;
  prof_user uuid;
begin
  select * into oferta from public.appointment_offers where id = oferta_id;
  if not found then
    raise exception 'Convite não encontrado';
  end if;

  select * into appt from public.appointments where id = oferta.appointment_id;

  if appt.client_id <> auth.uid() then
    raise exception 'Só a cliente do agendamento pode responder';
  end if;

  if oferta.status <> 'pendente' then
    raise exception 'Este convite já foi respondido';
  end if;

  if oferta.expires_at <= now() then
    update public.appointment_offers
    set status = 'expirada', responded_at = now()
    where id = oferta_id;
    return 'expirada';
  end if;

  select full_name into cliente_nome from public.profiles where id = appt.client_id;
  select user_id into prof_user from public.professionals where id = appt.professional_id;

  if not aceitar then
    update public.appointment_offers
    set status = 'recusada', responded_at = now()
    where id = oferta_id;

    if prof_user is not null then
      perform public.notificar(
        prof_user, 'agenda_adiantada', 'Adiantamento recusado',
        format('%s prefere manter as %s.',
               coalesce(cliente_nome, 'A cliente'),
               to_char(oferta.previous_start_time, 'HH24:MI')),
        '/pro', jsonb_build_object('appointment_id', appt.id), null
      );
    end if;
    return 'recusada';
  end if;

  -- alguém pode ter ocupado o horário entre o convite e o aceite
  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = oferta.proposed_date
      and a.id <> appt.id
      and a.status <> 'cancelado'
      and oferta.proposed_start_time < a.end_time
      and oferta.proposed_end_time > a.start_time
  ) then
    update public.appointment_offers
    set status = 'expirada', responded_at = now()
    where id = oferta_id;
    return 'conflito';
  end if;

  update public.appointments
  set date = oferta.proposed_date,
      start_time = oferta.proposed_start_time,
      end_time = oferta.proposed_end_time
  where id = appt.id;

  update public.appointment_offers
  set status = 'aceita', responded_at = now()
  where id = oferta_id;

  if prof_user is not null then
    perform public.notificar(
      prof_user, 'agenda_adiantada', 'Horário adiantado ✅',
      format('%s aceitou vir às %s.',
             coalesce(cliente_nome, 'A cliente'),
             to_char(oferta.proposed_start_time, 'HH24:MI')),
      '/pro', jsonb_build_object('appointment_id', appt.id), null
    );
  end if;

  return 'aceita';
end;
$$;

-- -------------------------------------------------------------
-- A profissional desiste do convite / desfaz o adiantamento
-- -------------------------------------------------------------
create or replace function public.cancelar_antecipacao(oferta_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.appointment_offers%rowtype;
  appt public.appointments%rowtype;
begin
  select * into oferta from public.appointment_offers where id = oferta_id;
  if not found then
    raise exception 'Convite não encontrado';
  end if;

  select * into appt from public.appointments where id = oferta.appointment_id;

  if not (public.is_admin() or public.is_professional(appt.professional_id)) then
    raise exception 'Sem permissão';
  end if;

  if oferta.status = 'pendente' then
    update public.appointment_offers
    set status = 'cancelada', responded_at = now()
    where id = oferta_id;
    return;
  end if;

  -- desfazer um adiantamento já aceito, se o horário antigo estiver livre
  if oferta.status = 'aceita' then
    if exists (
      select 1 from public.appointments a
      where a.professional_id = appt.professional_id
        and a.date = oferta.previous_date
        and a.id <> appt.id
        and a.status <> 'cancelado'
        and oferta.previous_start_time < a.end_time
        and oferta.previous_end_time > a.start_time
    ) then
      raise exception 'O horário original já foi ocupado';
    end if;

    update public.appointments
    set date = oferta.previous_date,
        start_time = oferta.previous_start_time,
        end_time = oferta.previous_end_time
    where id = appt.id;

    update public.appointment_offers
    set status = 'cancelada'
    where id = oferta_id;

    perform public.notificar(
      appt.client_id, 'agenda_adiantada', 'Seu horário voltou ao original',
      format('Voltamos para as %s.', to_char(oferta.previous_start_time, 'HH24:MI')),
      '/', jsonb_build_object('appointment_id', appt.id), null
    );
  end if;
end;
$$;

grant execute on function public.agora_local() to anon, authenticated;
grant execute on function public.horario_mais_cedo_possivel(uuid) to authenticated;
grant execute on function public.propor_antecipacao(uuid, time, integer) to authenticated;
grant execute on function public.responder_antecipacao(uuid, boolean) to authenticated;
grant execute on function public.cancelar_antecipacao(uuid) to authenticated;

-- =============================================================
-- >>> 011_lista_espera.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 011: lista de espera e falta da cliente
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 010).
--
-- Quem não achou o horário que queria entra na fila daquela faixa.
-- Quando uma vaga abre (cancelamento, falta ou remanejamento), a
-- primeira da fila é avisada e tem um tempo para responder antes de
-- a vaga passar para a próxima.
-- =============================================================

-- 1. Regras de tempo, ajustáveis por profissional -----------------------
alter table public.professionals
  add column if not exists waitlist_min_notice_minutes integer not null default 45
    check (waitlist_min_notice_minutes between 0 and 1440);

alter table public.professionals
  add column if not exists waitlist_hold_minutes integer not null default 15
    check (waitlist_hold_minutes between 5 and 240);

alter table public.professionals
  add column if not exists no_show_tolerance_minutes integer not null default 15
    check (no_show_tolerance_minutes between 0 and 240);

-- 2. Falta vira um status próprio ---------------------------------------
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('pendente', 'confirmado', 'cancelado', 'concluido', 'faltou'));

-- a vaga de quem faltou também volta a ficar livre
drop index if exists appointments_prof_slot_unique;
create unique index if not exists appointments_prof_slot_unique
  on public.appointments (professional_id, date, start_time)
  where status not in ('cancelado', 'faltou');

-- 3. A fila ---------------------------------------------------------------
create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  -- faixa de dias que serve para ela
  date_from date not null,
  date_to date not null,
  -- faixa de horário que serve para ela
  window_start time not null default '00:00',
  window_end time not null default '23:59',
  status text not null default 'aguardando'
    check (status in ('aguardando', 'convertida', 'cancelada', 'expirada')),
  created_at timestamptz not null default now(),
  check (date_to >= date_from),
  check (window_end > window_start)
);

create index if not exists waitlist_fila_idx
  on public.waitlist_entries (professional_id, status, created_at);

-- a mesma cliente não entra duas vezes na mesma fila
create unique index if not exists waitlist_sem_duplicata
  on public.waitlist_entries (client_id, professional_id, service_id, date_from, date_to, window_start, window_end)
  where status = 'aguardando';

-- 4. A vaga oferecida a quem está na fila ---------------------------------
create table if not exists public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.waitlist_entries (id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'aceita', 'recusada', 'expirada')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_offers_abertas_idx
  on public.waitlist_offers (status, expires_at);

alter table public.waitlist_entries enable row level security;
alter table public.waitlist_offers enable row level security;

drop policy if exists "ver minha fila" on public.waitlist_entries;
create policy "ver minha fila"
  on public.waitlist_entries for select
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin()
    or public.is_professional(professional_id)
  );

drop policy if exists "ver ofertas de vaga" on public.waitlist_offers;
create policy "ver ofertas de vaga"
  on public.waitlist_offers for select
  to authenticated
  using (
    exists (
      select 1 from public.waitlist_entries e
      where e.id = waitlist_offers.entry_id
        and (
          e.client_id = auth.uid()
          or public.is_admin()
          or public.is_professional(e.professional_id)
        )
    )
  );

revoke insert, update, delete on public.waitlist_entries from authenticated, anon;
revoke insert, update, delete on public.waitlist_offers from authenticated, anon;

-- 5. Entrar e sair da fila ------------------------------------------------
create or replace function public.entrar_lista_espera(
  prof uuid,
  servico uuid,
  dia_de date,
  dia_ate date,
  hora_de time default '00:00',
  hora_ate time default '23:59'
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para avisarmos quando abrir vaga';
  end if;
  if dia_ate < dia_de then
    raise exception 'O último dia não pode ser antes do primeiro';
  end if;
  if dia_ate < public.agora_local()::date then
    raise exception 'Escolha dias que ainda estão por vir';
  end if;
  if hora_ate <= hora_de then
    raise exception 'A faixa de horário está invertida';
  end if;

  insert into public.waitlist_entries
    (client_id, professional_id, service_id, date_from, date_to, window_start, window_end)
  values (auth.uid(), prof, servico, dia_de, dia_ate, hora_de, hora_ate)
  on conflict do nothing
  returning id into novo_id;

  if novo_id is null then
    select id into novo_id from public.waitlist_entries
    where client_id = auth.uid() and professional_id = prof and service_id = servico
      and date_from = dia_de and date_to = dia_ate
      and window_start = hora_de and window_end = hora_ate
      and status = 'aguardando';
  end if;

  return novo_id;
end;
$$;

create or replace function public.sair_lista_espera(entrada_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.waitlist_entries
  set status = 'cancelada'
  where id = entrada_id and client_id = auth.uid() and status = 'aguardando';

  update public.waitlist_offers
  set status = 'recusada'
  where entry_id = entrada_id and status = 'pendente';
end;
$$;

-- 6. Oferecer uma vaga que abriu -----------------------------------------
-- Chama a próxima da fila que ainda não recebeu esta vaga.
create or replace function public.ofertar_vaga(
  prof uuid,
  dia date,
  inicio time,
  fim time
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  entrada public.waitlist_entries%rowtype;
  cfg public.professionals%rowtype;
  duracao_servico integer;
  agora timestamp := public.agora_local();
  oferta_id uuid;
  serv_nome text;
begin
  select * into cfg from public.professionals where id = prof;
  if not found then
    return null;
  end if;

  -- vaga em cima da hora demais: não vale avisar ninguém
  if (dia + inicio) < agora + make_interval(mins => cfg.waitlist_min_notice_minutes) then
    return null;
  end if;

  -- a vaga precisa continuar livre
  if exists (
    select 1 from public.appointments a
    where a.professional_id = prof and a.date = dia
      and a.status not in ('cancelado', 'faltou')
      and inicio < a.end_time and fim > a.start_time
  ) then
    return null;
  end if;

  -- primeira da fila cujo serviço cabe na vaga e cuja faixa bate
  select e.* into entrada
  from public.waitlist_entries e
  join public.services s on s.id = e.service_id
  where e.professional_id = prof
    and e.status = 'aguardando'
    and dia between e.date_from and e.date_to
    and inicio >= e.window_start
    and (inicio + make_interval(mins => s.duration_minutes)) <= e.window_end
    and (inicio + make_interval(mins => s.duration_minutes)) <= fim
    -- ninguém recebe a mesma vaga duas vezes
    and not exists (
      select 1 from public.waitlist_offers o
      where o.entry_id = e.id and o.date = dia and o.start_time = inicio
    )
    -- uma oferta aberta por vez para cada pessoa
    and not exists (
      select 1 from public.waitlist_offers o
      where o.entry_id = e.id and o.status = 'pendente' and o.expires_at > now()
    )
  order by e.created_at
  limit 1;

  if not found then
    return null;
  end if;

  select duration_minutes, name into duracao_servico, serv_nome
  from public.services where id = entrada.service_id;

  insert into public.waitlist_offers (entry_id, date, start_time, end_time, expires_at)
  values (
    entrada.id, dia, inicio,
    (inicio + make_interval(mins => duracao_servico))::time,
    now() + make_interval(mins => cfg.waitlist_hold_minutes)
  )
  returning id into oferta_id;

  perform public.notificar(
    entrada.client_id,
    'vaga_disponivel',
    'Abriu uma vaga! 🎉',
    format('%s tem %s livre dia %s às %s. A vaga fica guardada para você por %s minutos.',
           cfg.name, coalesce(serv_nome, 'o serviço'),
           to_char(dia, 'DD/MM'), to_char(inicio, 'HH24:MI'),
           cfg.waitlist_hold_minutes),
    '/',
    jsonb_build_object('offer_id', oferta_id, 'entry_id', entrada.id),
    now() + make_interval(mins => cfg.waitlist_hold_minutes)
  );

  return oferta_id;
end;
$$;

-- 7. A cliente responde à vaga -------------------------------------------
create or replace function public.responder_vaga(oferta_id uuid, aceitar boolean)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.waitlist_offers%rowtype;
  entrada public.waitlist_entries%rowtype;
  prof_user uuid;
  cliente_nome text;
begin
  select * into oferta from public.waitlist_offers where id = oferta_id;
  if not found then
    raise exception 'Oferta não encontrada';
  end if;

  select * into entrada from public.waitlist_entries where id = oferta.entry_id;

  if entrada.client_id <> auth.uid() then
    raise exception 'Esta vaga não é sua';
  end if;

  if oferta.status <> 'pendente' then
    raise exception 'Esta vaga já foi respondida';
  end if;

  if oferta.expires_at <= now() then
    update public.waitlist_offers set status = 'expirada' where id = oferta_id;
    perform public.ofertar_vaga(entrada.professional_id, oferta.date, oferta.start_time, oferta.end_time);
    return 'expirada';
  end if;

  if not aceitar then
    update public.waitlist_offers set status = 'recusada' where id = oferta_id;
    -- passa para a próxima da fila
    perform public.ofertar_vaga(entrada.professional_id, oferta.date, oferta.start_time, oferta.end_time);
    return 'recusada';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = entrada.professional_id and a.date = oferta.date
      and a.status not in ('cancelado', 'faltou')
      and oferta.start_time < a.end_time and oferta.end_time > a.start_time
  ) then
    update public.waitlist_offers set status = 'expirada' where id = oferta_id;
    return 'conflito';
  end if;

  insert into public.appointments
    (client_id, professional_id, service_id, date, start_time, end_time, status)
  values
    (entrada.client_id, entrada.professional_id, entrada.service_id,
     oferta.date, oferta.start_time, oferta.end_time, 'confirmado');

  update public.waitlist_offers set status = 'aceita' where id = oferta_id;
  update public.waitlist_entries set status = 'convertida' where id = entrada.id;

  select user_id into prof_user from public.professionals where id = entrada.professional_id;
  select full_name into cliente_nome from public.profiles where id = entrada.client_id;

  if prof_user is not null then
    perform public.notificar(
      prof_user, 'novo_agendamento', 'Vaga preenchida pela lista de espera 🎉',
      format('%s pegou o horário de %s às %s.',
             coalesce(cliente_nome, 'Uma cliente'),
             to_char(oferta.date, 'DD/MM'), to_char(oferta.start_time, 'HH24:MI')),
      '/pro', jsonb_build_object('date', oferta.date), null
    );
  end if;

  return 'aceita';
end;
$$;

-- 8. Vaga não respondida passa para a próxima -----------------------------
create or replace function public.avancar_ofertas_expiradas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  o record;
  n integer := 0;
begin
  for o in
    select wo.id, wo.date, wo.start_time, wo.end_time, we.professional_id
    from public.waitlist_offers wo
    join public.waitlist_entries we on we.id = wo.entry_id
    where wo.status = 'pendente' and wo.expires_at <= now()
    limit 50
  loop
    update public.waitlist_offers set status = 'expirada' where id = o.id;
    perform public.ofertar_vaga(o.professional_id, o.date, o.start_time, o.end_time);
    n := n + 1;
  end loop;

  -- limpeza: filas cujo último dia já passou
  update public.waitlist_entries
  set status = 'expirada'
  where status = 'aguardando' and date_to < public.agora_local()::date;

  return n;
end;
$$;

-- 9. Quando uma vaga abre, a fila é acionada sozinha ----------------------
create or replace function public.ao_liberar_horario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- saiu da agenda (cancelou ou faltou): o horário antigo está livre
  if new.status in ('cancelado', 'faltou') and old.status not in ('cancelado', 'faltou') then
    perform public.ofertar_vaga(old.professional_id, old.date, old.start_time, old.end_time);

  -- foi remanejado: o horário anterior está livre
  elsif new.status not in ('cancelado', 'faltou')
    and (old.date, old.start_time) is distinct from (new.date, new.start_time) then
    perform public.ofertar_vaga(old.professional_id, old.date, old.start_time, old.end_time);
  end if;

  return new;
end;
$$;

drop trigger if exists on_horario_liberado on public.appointments;
create trigger on_horario_liberado
  after update on public.appointments
  for each row execute function public.ao_liberar_horario();

-- 10. Histórico de faltas da cliente --------------------------------------
create or replace function public.faltas_da_cliente(cliente uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(*)::integer
  from public.appointments
  where client_id = cliente
    and status = 'faltou'
    and date >= (public.agora_local()::date - interval '6 months');
$$;

grant execute on function public.entrar_lista_espera(uuid, uuid, date, date, time, time) to authenticated;
grant execute on function public.sair_lista_espera(uuid) to authenticated;
grant execute on function public.responder_vaga(uuid, boolean) to authenticated;
grant execute on function public.avancar_ofertas_expiradas() to authenticated;
grant execute on function public.faltas_da_cliente(uuid) to authenticated;

-- =============================================================
-- OPCIONAL: para a fila andar sozinha mesmo com o app fechado,
-- ative a extensão pg_cron (Database → Extensions) e rode:
--
-- select cron.schedule('agenda-mel-fila', '* * * * *',
--   $cron$ select public.avancar_ofertas_expiradas(); $cron$);
--
-- Sem isso, a fila avança quando alguém abre o app — o que já cobre
-- o caso normal, só com um pouco mais de atraso.
-- =============================================================

-- =============================================================
-- >>> 012_indique_e_ganhe.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 012: indique e ganhe
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 011).
--
-- REGRA CENTRAL: o crédito das duas pontas só nasce quando o primeiro
-- atendimento da indicada é CONCLUÍDO pela profissional. Creditar no
-- agendamento seria convite a agendamento fantasma.
-- =============================================================

-- 1. Regras do programa (uma linha só, editável pelo admin) --------------
create table if not exists public.referral_settings (
  id boolean primary key default true check (id),
  ativo boolean not null default true,
  -- quanto cada lado ganha, em centavos
  premio_indicou_cents integer not null default 2000 check (premio_indicou_cents >= 0),
  premio_indicada_cents integer not null default 1000 check (premio_indicada_cents >= 0),
  -- teto mensal de indicações premiadas por pessoa (trava antifraude)
  max_premios_por_mes integer not null default 10 check (max_premios_por_mes > 0),
  -- validade do crédito
  validade_dias integer not null default 180 check (validade_dias > 0)
);

insert into public.referral_settings (id) values (true) on conflict do nothing;

alter table public.referral_settings enable row level security;

drop policy if exists "ver regras de indicacao" on public.referral_settings;
create policy "ver regras de indicacao"
  on public.referral_settings for select
  to anon, authenticated using (true);

drop policy if exists "admin edita regras de indicacao" on public.referral_settings;
create policy "admin edita regras de indicacao"
  on public.referral_settings for update
  to authenticated using (public.is_admin());

-- 2. Código pessoal de cada cliente --------------------------------------
alter table public.profiles
  add column if not exists referral_code text unique;

create or replace function public.gerar_codigo_indicacao(nome text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  base text;
  candidato text;
  tentativa integer := 0;
begin
  base := upper(regexp_replace(
    translate(coalesce(split_part(nome, ' ', 1), 'MEL'),
              'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCAAAAEEIOOOUC'),
    '[^A-Za-z]', '', 'g'));
  if base = '' or base is null then
    base := 'MEL';
  end if;
  base := left(base, 6);

  loop
    candidato := base || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.profiles where referral_code = candidato);
    tentativa := tentativa + 1;
    if tentativa > 20 then
      candidato := base || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      exit;
    end if;
  end loop;

  return candidato;
end;
$$;

-- toda conta nova já nasce com código
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, referral_code)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    public.gerar_codigo_indicacao(new.raw_user_meta_data ->> 'full_name')
  );
  return new;
end;
$$;

-- quem já tinha conta ganha o código agora
update public.profiles
set referral_code = public.gerar_codigo_indicacao(full_name)
where referral_code is null;

-- 3. Indicações -----------------------------------------------------------
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  -- cada pessoa só pode ser indicada uma vez na vida
  referred_id uuid not null unique references public.profiles (id) on delete cascade,
  code text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'creditada', 'bloqueada')),
  appointment_id uuid references public.appointments (id) on delete set null,
  motivo_bloqueio text,
  created_at timestamptz not null default now(),
  credited_at timestamptz,
  check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_id, status, credited_at);

-- 4. Carteira de créditos -------------------------------------------------
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  -- positivo = ganhou, negativo = usou
  amount_cents integer not null,
  kind text not null check (kind in ('indicacao', 'indicacao_bonus', 'uso', 'ajuste', 'expiracao')),
  description text,
  referral_id uuid references public.referrals (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists credit_client_idx
  on public.credit_transactions (client_id, created_at desc);

alter table public.referrals enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists "ver minhas indicacoes" on public.referrals;
create policy "ver minhas indicacoes"
  on public.referrals for select
  to authenticated
  using (referrer_id = auth.uid() or referred_id = auth.uid() or public.is_admin());

drop policy if exists "ver meus creditos" on public.credit_transactions;
create policy "ver meus creditos"
  on public.credit_transactions for select
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.appointments a
      where a.id = credit_transactions.appointment_id
        and public.is_professional(a.professional_id)
    )
  );

revoke insert, update, delete on public.referrals from authenticated, anon;
revoke insert, update, delete on public.credit_transactions from authenticated, anon;

-- 5. Saldo ----------------------------------------------------------------
create or replace function public.saldo_creditos(cliente uuid default auth.uid())
returns integer
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(amount_cents), 0)::integer
  from public.credit_transactions
  where client_id = cliente
    and (expires_at is null or expires_at > now());
$$;

-- 6. Registrar a indicação (chamado logo após o cadastro) -----------------
create or replace function public.registrar_indicacao(codigo text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  quem_indicou public.profiles%rowtype;
  eu public.profiles%rowtype;
  cfg public.referral_settings%rowtype;
  tel_meu text;
  tel_dele text;
begin
  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return 'programa_inativo';
  end if;

  if auth.uid() is null then
    raise exception 'Entre na sua conta primeiro';
  end if;

  select * into eu from public.profiles where id = auth.uid();
  select * into quem_indicou from public.profiles
  where referral_code = upper(trim(codigo));

  if not found then
    return 'codigo_invalido';
  end if;

  -- autoindicação
  if quem_indicou.id = eu.id then
    return 'codigo_proprio';
  end if;

  -- já foi indicada alguma vez
  if exists (select 1 from public.referrals where referred_id = eu.id) then
    return 'ja_indicada';
  end if;

  -- conta antiga não vale como indicação nova
  if exists (
    select 1 from public.appointments
    where client_id = eu.id and status = 'concluido'
  ) then
    return 'conta_antiga';
  end if;

  -- mesmo telefone dos dois lados: trava de conta fantasma
  tel_meu := regexp_replace(coalesce(eu.phone, ''), '[^0-9]', '', 'g');
  tel_dele := regexp_replace(coalesce(quem_indicou.phone, ''), '[^0-9]', '', 'g');
  if length(tel_meu) >= 10 and tel_meu = tel_dele then
    insert into public.referrals (referrer_id, referred_id, code, status, motivo_bloqueio)
    values (quem_indicou.id, eu.id, upper(trim(codigo)), 'bloqueada', 'mesmo telefone');
    return 'bloqueada';
  end if;

  insert into public.referrals (referrer_id, referred_id, code)
  values (quem_indicou.id, eu.id, upper(trim(codigo)));

  return 'registrada';
end;
$$;

-- 7. O crédito nasce quando o atendimento é CONCLUÍDO ---------------------
create or replace function public.creditar_indicacao_se_couber()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ind public.referrals%rowtype;
  cfg public.referral_settings%rowtype;
  premiados_no_mes integer;
  nome_indicada text;
  nome_indicou text;
  validade timestamptz;
begin
  if new.status <> 'concluido' or old.status = 'concluido' then
    return new;
  end if;

  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return new;
  end if;

  select * into ind from public.referrals
  where referred_id = new.client_id and status = 'pendente';
  if not found then
    return new;
  end if;

  -- precisa ser o PRIMEIRO atendimento concluído dela
  if exists (
    select 1 from public.appointments
    where client_id = new.client_id
      and status = 'concluido'
      and id <> new.id
  ) then
    update public.referrals
    set status = 'bloqueada', motivo_bloqueio = 'nao era o primeiro atendimento'
    where id = ind.id;
    return new;
  end if;

  -- teto mensal de quem indica
  select count(*) into premiados_no_mes
  from public.referrals
  where referrer_id = ind.referrer_id
    and status = 'creditada'
    and credited_at >= date_trunc('month', now());

  if premiados_no_mes >= cfg.max_premios_por_mes then
    update public.referrals
    set status = 'bloqueada', motivo_bloqueio = 'teto mensal atingido'
    where id = ind.id;
    return new;
  end if;

  select full_name into nome_indicada from public.profiles where id = ind.referred_id;
  select full_name into nome_indicou from public.profiles where id = ind.referrer_id;
  validade := now() + make_interval(days => cfg.validade_dias);

  if cfg.premio_indicou_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referrer_id, cfg.premio_indicou_cents, 'indicacao',
            format('Indicação de %s', coalesce(nome_indicada, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referrer_id, 'indicacao_creditada', 'Seu crédito chegou! 🎁',
      format('%s fez o primeiro atendimento e você ganhou %s de crédito.',
             coalesce(nome_indicada, 'Sua indicada'),
             to_char(cfg.premio_indicou_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  if cfg.premio_indicada_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referred_id, cfg.premio_indicada_cents, 'indicacao_bonus',
            format('Bônus de boas-vindas (indicada por %s)', coalesce(nome_indicou, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referred_id, 'indicacao_creditada', 'Bônus de boas-vindas 🎁',
      format('Você ganhou %s de crédito para o próximo atendimento.',
             to_char(cfg.premio_indicada_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  update public.referrals
  set status = 'creditada', credited_at = now(), appointment_id = new.id
  where id = ind.id;

  return new;
end;
$$;

drop trigger if exists on_atendimento_concluido on public.appointments;
create trigger on_atendimento_concluido
  after update on public.appointments
  for each row execute function public.creditar_indicacao_se_couber();

-- 8. Usar o crédito no atendimento ---------------------------------------
create or replace function public.usar_credito(appt_id uuid, valor_cents integer)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  saldo integer;
  preco_cents integer;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin() or public.is_professional(appt.professional_id)) then
    raise exception 'Só a profissional do atendimento pode abater crédito';
  end if;

  if valor_cents <= 0 then
    raise exception 'Valor inválido';
  end if;

  saldo := public.saldo_creditos(appt.client_id);
  if valor_cents > saldo then
    raise exception 'Crédito insuficiente';
  end if;

  select round(price * 100)::integer into preco_cents
  from public.services where id = appt.service_id;

  if preco_cents is not null and valor_cents > preco_cents then
    raise exception 'O abatimento não pode passar do valor do serviço';
  end if;

  if exists (
    select 1 from public.credit_transactions
    where appointment_id = appt_id and kind = 'uso'
  ) then
    raise exception 'Este atendimento já teve crédito abatido';
  end if;

  insert into public.credit_transactions
    (client_id, amount_cents, kind, description, appointment_id)
  values (appt.client_id, -valor_cents, 'uso', 'Abatido no atendimento', appt_id);

  perform public.notificar(
    appt.client_id, 'indicacao_creditada', 'Crédito usado',
    format('Abatemos %s no seu atendimento.',
           to_char(valor_cents / 100.0, 'FM999G990D00')),
    '/indique', jsonb_build_object('appointment_id', appt_id), null
  );

  return public.saldo_creditos(appt.client_id);
end;
$$;

-- 9. Resumo do programa para a tela "Indique e ganhe" ---------------------
create or replace function public.meu_resumo_indicacoes()
returns table (
  codigo text,
  saldo_cents integer,
  indicadas_total integer,
  indicadas_creditadas integer,
  premio_indicou_cents integer,
  premio_indicada_cents integer
)
language sql
stable
security definer set search_path = public
as $$
  select
    p.referral_code,
    public.saldo_creditos(auth.uid()),
    (select count(*)::integer from public.referrals r where r.referrer_id = auth.uid()),
    (select count(*)::integer from public.referrals r
      where r.referrer_id = auth.uid() and r.status = 'creditada'),
    s.premio_indicou_cents,
    s.premio_indicada_cents
  from public.profiles p
  cross join public.referral_settings s
  where p.id = auth.uid() and s.id;
$$;

grant execute on function public.saldo_creditos(uuid) to authenticated;
grant execute on function public.registrar_indicacao(text) to authenticated;
grant execute on function public.usar_credito(uuid, integer) to authenticated;
grant execute on function public.meu_resumo_indicacoes() to authenticated;

-- =============================================================
-- >>> 013_seguranca.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 013: fechar o que estava aberto
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 012).
--
-- Uma revisão encontrou quatro buracos no que já estava no ar. Este
-- arquivo fecha todos. Rode antes de colocar qualquer cliente real.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Funções internas estavam abertas para qualquer um
--
-- O Postgres concede execução de função a PUBLIC por padrão, e o
-- PostgREST publica tudo que está no schema public. Na prática,
-- qualquer pessoa com a chave pública do app podia chamar
-- notificar() e injetar aviso no celular de qualquer cliente.
-- -------------------------------------------------------------
revoke execute on function public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

revoke execute on function public.ofertar_vaga(uuid, date, time, time)
  from public, anon, authenticated;

revoke execute on function public.gerar_codigo_indicacao(text)
  from public, anon, authenticated;

-- funções de gatilho não precisam ser chamáveis por ninguém
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.seed_professional_hours() from public, anon, authenticated;
revoke execute on function public.ao_liberar_horario() from public, anon, authenticated;
revoke execute on function public.creditar_indicacao_se_couber() from public, anon, authenticated;

-- -------------------------------------------------------------
-- 2. Consultas que liam dado de outra pessoa
--
-- saldo_creditos(uuid) e faltas_da_cliente(uuid) eram SECURITY
-- DEFINER e aceitavam qualquer identificador: bastava passar o de
-- outra cliente para ler o saldo ou o histórico de faltas dela.
-- -------------------------------------------------------------

-- a profissional só enxerga quem já agendou com ela
create or replace function public.atende_esta_cliente(cliente uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.client_id = cliente
      and public.is_professional(a.professional_id)
  );
$$;

create or replace function public.saldo_creditos(cliente uuid default auth.uid())
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if cliente is null then
    return 0;
  end if;
  if not (
    cliente = auth.uid()
    or public.is_admin()
    or public.atende_esta_cliente(cliente)
  ) then
    raise exception 'Sem permissão para ver este saldo';
  end if;

  return (
    select coalesce(sum(amount_cents), 0)::integer
    from public.credit_transactions
    where client_id = cliente
      and (expires_at is null or expires_at > now())
  );
end;
$$;

create or replace function public.faltas_da_cliente(cliente uuid)
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not (
    cliente = auth.uid()
    or public.is_admin()
    or public.atende_esta_cliente(cliente)
  ) then
    raise exception 'Sem permissão';
  end if;

  return (
    select count(*)::integer
    from public.appointments
    where client_id = cliente
      and status = 'faltou'
      and date >= (public.agora_local()::date - interval '6 months')
  );
end;
$$;

grant execute on function public.atende_esta_cliente(uuid) to authenticated;
grant execute on function public.saldo_creditos(uuid) to authenticated;
grant execute on function public.faltas_da_cliente(uuid) to authenticated;

-- -------------------------------------------------------------
-- 3. A cliente podia concluir o próprio atendimento
--
-- A política de update não tinha WITH CHECK e a tabela não tinha
-- limite de coluna. Dava para a cliente mudar data, horário e
-- status pelo navegador — inclusive marcar 'concluido', que é o
-- gatilho do crédito de indicação. Ou seja: crédito sem atendimento.
-- -------------------------------------------------------------

-- pela API, a cliente só encosta em status e observação
revoke update on public.appointments from authenticated;
grant update (status, notes) on public.appointments to authenticated;

drop policy if exists "alterar agendamentos" on public.appointments;
create policy "alterar agendamentos"
  on public.appointments for update
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin()
    or public.is_professional(professional_id)
  )
  with check (
    client_id = auth.uid()
    or public.is_admin()
    or public.is_professional(professional_id)
  );

-- e a única mudança de status que ela pode fazer é cancelar
create or replace function public.valida_status_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- rodando dentro de uma função do servidor (SECURITY DEFINER) ou
  -- pelo service_role: já foi validado lá dentro
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not (public.is_admin() or public.is_professional(new.professional_id)) then
      if new.status <> 'pendente' then
        raise exception 'Um agendamento novo começa como pendente';
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if public.is_admin() or public.is_professional(old.professional_id) then
      return new;
    end if;

    if old.client_id = auth.uid() then
      if new.status <> 'cancelado' then
        raise exception 'Você só pode cancelar o seu agendamento';
      end if;
      if old.status not in ('pendente', 'confirmado') then
        raise exception 'Este agendamento não pode mais ser cancelado';
      end if;
      return new;
    end if;

    raise exception 'Sem permissão para alterar este agendamento';
  end if;

  return new;
end;
$$;

revoke execute on function public.valida_status_agendamento() from public, anon, authenticated;

drop trigger if exists on_valida_status on public.appointments;
create trigger on_valida_status
  before insert or update on public.appointments
  for each row execute function public.valida_status_agendamento();

-- -------------------------------------------------------------
-- 4. Dois atendimentos podiam se sobrepor
--
-- O índice único só olhava o horário de INÍCIO: 14:00–15:00 e
-- 14:30–15:30 passavam os dois. Agora o próprio banco recusa
-- qualquer sobreposição na agenda da mesma profissional.
-- -------------------------------------------------------------
create extension if not exists btree_gist;

do $$
declare
  sobrepostos integer;
begin
  select count(*) into sobrepostos
  from public.appointments a
  join public.appointments b
    on a.professional_id = b.professional_id
   and a.date = b.date
   and a.id < b.id
   and a.status not in ('cancelado', 'faltou')
   and b.status not in ('cancelado', 'faltou')
   and a.start_time < b.end_time
   and b.start_time < a.end_time;

  if sobrepostos > 0 then
    raise notice 'ATENÇÃO: existem % pares de atendimentos sobrepostos. Ajuste-os e rode este bloco de novo para criar a trava.', sobrepostos;
  else
    alter table public.appointments
      drop constraint if exists appointments_sem_sobreposicao;
    -- o Postgres não tem um tipo "faixa de hora" pronto, então a faixa
    -- é montada como data + hora (tsrange), que já existe
    alter table public.appointments
      add constraint appointments_sem_sobreposicao
      exclude using gist (
        professional_id with =,
        tsrange(date + start_time, date + end_time) with &&
      ) where (status not in ('cancelado', 'faltou'));
  end if;
end;
$$;

-- agendamento sem profissional escapava de qualquer trava
do $$
begin
  if not exists (select 1 from public.appointments where professional_id is null) then
    alter table public.appointments alter column professional_id set not null;
  else
    raise notice 'ATENÇÃO: há agendamentos sem profissional (anteriores à equipe). Preencha-os para ativar a trava.';
  end if;
end;
$$;

-- -------------------------------------------------------------
-- 5. Quem faltou continuava ocupando a grade pública
--
-- O índice de conflito passou a ignorar 'faltou' no arquivo 011,
-- mas get_busy_slots não — então a vaga liberada pela falta não
-- aparecia para ninguém.
-- -------------------------------------------------------------
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
    and a.status not in ('cancelado', 'faltou');
$$;

grant execute on function public.get_busy_slots(date, uuid) to anon, authenticated;

-- -------------------------------------------------------------
-- 6. O telefone das profissionais estava público na internet
-- -------------------------------------------------------------
revoke select on public.professionals from anon;
grant select (id, name, slug, bio, photo_url, active, created_at)
  on public.professionals to anon;

-- -------------------------------------------------------------
-- 7. Uma profissional podia apagar a foto de outra
--
-- A foto passa a morar numa pasta com o identificador da dona, e a
-- permissão confere a pasta.
-- -------------------------------------------------------------
drop policy if exists "equipe envia foto de profissional" on storage.objects;
create policy "equipe envia foto de profissional"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'professional-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.my_professional_id()::text
    )
  );

drop policy if exists "equipe atualiza foto de profissional" on storage.objects;
create policy "equipe atualiza foto de profissional"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'professional-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.my_professional_id()::text
    )
  );

drop policy if exists "equipe remove foto de profissional" on storage.objects;
create policy "equipe remove foto de profissional"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'professional-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.my_professional_id()::text
    )
  );

-- =============================================================
-- >>> 014_correcoes.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 014: correções da revisão
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 013).
--
-- Fecha os defeitos de regra encontrados na revisão adversarial das
-- três features: horário no passado, vaga que some da fila, saldo
-- negativo, crédito dobrado e as discordâncias sobre "faltou".
-- =============================================================

-- -------------------------------------------------------------
-- 1. "Faltou" agora é horário LIVRE para todo mundo
--
-- O 011 passou a tratar falta como vaga livre, mas as funções de
-- adiantar agenda continuaram contando quem faltou como ocupado.
-- As duas features discordavam sobre a mesma agenda.
-- -------------------------------------------------------------
create or replace function public.horario_mais_cedo_possivel(appt_id uuid)
returns time
language plpgsql
stable
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  duracao interval;
  limite_anterior time;
  expediente_inicio time;
  candidato time;
  minutos integer;
  agora timestamp := public.agora_local();
begin
  select * into appt from public.appointments where id = appt_id;
  if not found or appt.status not in ('pendente', 'confirmado') then
    return null;
  end if;

  duracao := appt.end_time - appt.start_time;

  select h.start_time into expediente_inicio
  from public.professional_hours h
  where h.professional_id = appt.professional_id
    and h.weekday = extract(dow from appt.date)
    and h.open;
  if expediente_inicio is null then
    return null;
  end if;

  select max(a.end_time) into limite_anterior
  from public.appointments a
  where a.professional_id = appt.professional_id
    and a.date = appt.date
    and a.id <> appt.id
    and a.status not in ('cancelado', 'faltou')
    and a.end_time <= appt.start_time;

  candidato := greatest(expediente_inicio, coalesce(limite_anterior, expediente_inicio));

  if appt.date < agora::date then
    return null;
  end if;
  if appt.date = agora::date then
    candidato := greatest(candidato, (agora + interval '5 minutes')::time);
  end if;

  minutos := extract(hour from candidato)::int * 60 + extract(minute from candidato)::int;
  minutos := (ceil(minutos / 5.0) * 5)::int;
  if minutos >= 24 * 60 then
    return null;
  end if;
  candidato := make_time(minutos / 60, minutos % 60, 0);

  if candidato >= appt.start_time then
    return null;
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = appt.date
      and a.id <> appt.id
      and a.status not in ('cancelado', 'faltou')
      and candidato < a.end_time
      and (candidato + duracao) > a.start_time
  ) then
    return null;
  end if;

  return candidato;
end;
$$;

-- -------------------------------------------------------------
-- 2. Convite não pode propor (nem ser aceito para) horário passado
-- -------------------------------------------------------------
create or replace function public.propor_antecipacao(
  appt_id uuid,
  novo_inicio time,
  minutos_para_responder integer default 15
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  duracao interval;
  novo_fim time;
  expediente_inicio time;
  prof_nome text;
  serv_nome text;
  oferta_id uuid;
  agora timestamp := public.agora_local();
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin() or public.is_professional(appt.professional_id)) then
    raise exception 'Só a profissional do atendimento pode propor adiantar';
  end if;

  if appt.status not in ('pendente', 'confirmado') then
    raise exception 'Este agendamento não está mais aberto';
  end if;

  if novo_inicio >= appt.start_time then
    raise exception 'O novo horário precisa ser mais cedo que o atual';
  end if;

  -- nunca para o passado
  if (appt.date + novo_inicio) <= agora then
    raise exception 'Esse horário já passou';
  end if;

  -- nem antes de a profissional abrir
  select h.start_time into expediente_inicio
  from public.professional_hours h
  where h.professional_id = appt.professional_id
    and h.weekday = extract(dow from appt.date)
    and h.open;
  if expediente_inicio is null or novo_inicio < expediente_inicio then
    raise exception 'Esse horário está fora do seu expediente';
  end if;

  if minutos_para_responder < 5 or minutos_para_responder > 240 then
    raise exception 'O prazo de resposta deve ficar entre 5 e 240 minutos';
  end if;

  duracao := appt.end_time - appt.start_time;
  novo_fim := novo_inicio + duracao;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = appt.date
      and a.id <> appt.id
      and a.status not in ('cancelado', 'faltou')
      and novo_inicio < a.end_time
      and novo_fim > a.start_time
  ) then
    raise exception 'Esse horário conflita com outro atendimento';
  end if;

  update public.appointment_offers
  set status = 'cancelada', responded_at = now()
  where appointment_id = appt_id and status = 'pendente';

  insert into public.appointment_offers (
    appointment_id, proposed_date, proposed_start_time, proposed_end_time,
    previous_date, previous_start_time, previous_end_time,
    expires_at, created_by
  ) values (
    appt_id, appt.date, novo_inicio, novo_fim,
    appt.date, appt.start_time, appt.end_time,
    -- o prazo nunca passa do próprio horário proposto
    least(now() + make_interval(mins => minutos_para_responder),
          now() + greatest(
            interval '1 minute',
            (appt.date + novo_inicio) - agora - interval '5 minutes')),
    auth.uid()
  )
  returning id into oferta_id;

  select p.name into prof_nome from public.professionals p where p.id = appt.professional_id;
  select s.name into serv_nome from public.services s where s.id = appt.service_id;

  perform public.notificar(
    appt.client_id,
    'agenda_adiantada',
    'Dá para adiantar seu horário?',
    format('%s pode te atender às %s em vez de %s (%s).',
           coalesce(prof_nome, 'Sua profissional'),
           to_char(novo_inicio, 'HH24:MI'),
           to_char(appt.start_time, 'HH24:MI'),
           coalesce(serv_nome, 'seu serviço')),
    '/',
    jsonb_build_object('offer_id', oferta_id, 'appointment_id', appt_id),
    now() + make_interval(mins => minutos_para_responder)
  );

  return oferta_id;
end;
$$;

create or replace function public.responder_antecipacao(
  oferta_id uuid,
  aceitar boolean
)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.appointment_offers%rowtype;
  appt public.appointments%rowtype;
  cliente_nome text;
  prof_user uuid;
  agora timestamp := public.agora_local();
begin
  select * into oferta from public.appointment_offers where id = oferta_id;
  if not found then
    raise exception 'Convite não encontrado';
  end if;

  select * into appt from public.appointments where id = oferta.appointment_id;

  if appt.client_id <> auth.uid() then
    raise exception 'Só a cliente do agendamento pode responder';
  end if;

  if oferta.status <> 'pendente' then
    raise exception 'Este convite já foi respondido';
  end if;

  -- o agendamento pode ter sido cancelado ou marcado como falta
  if appt.status not in ('pendente', 'confirmado') then
    update public.appointment_offers
    set status = 'cancelada', responded_at = now()
    where id = oferta_id;
    return 'expirada';
  end if;

  -- prazo vencido OU o horário proposto já passou
  if oferta.expires_at <= now()
     or (oferta.proposed_date + oferta.proposed_start_time) <= agora then
    update public.appointment_offers
    set status = 'expirada', responded_at = now()
    where id = oferta_id;
    return 'expirada';
  end if;

  select full_name into cliente_nome from public.profiles where id = appt.client_id;
  select user_id into prof_user from public.professionals where id = appt.professional_id;

  if not aceitar then
    update public.appointment_offers
    set status = 'recusada', responded_at = now()
    where id = oferta_id;

    if prof_user is not null then
      perform public.notificar(
        prof_user, 'agenda_adiantada', 'Adiantamento recusado',
        format('%s prefere manter as %s.',
               coalesce(cliente_nome, 'A cliente'),
               to_char(oferta.previous_start_time, 'HH24:MI')),
        '/pro', jsonb_build_object('appointment_id', appt.id), null
      );
    end if;
    return 'recusada';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = oferta.proposed_date
      and a.id <> appt.id
      and a.status not in ('cancelado', 'faltou')
      and oferta.proposed_start_time < a.end_time
      and oferta.proposed_end_time > a.start_time
  ) then
    update public.appointment_offers
    set status = 'expirada', responded_at = now()
    where id = oferta_id;
    return 'conflito';
  end if;

  update public.appointments
  set date = oferta.proposed_date,
      start_time = oferta.proposed_start_time,
      end_time = oferta.proposed_end_time
  where id = appt.id;

  update public.appointment_offers
  set status = 'aceita', responded_at = now()
  where id = oferta_id;

  if prof_user is not null then
    perform public.notificar(
      prof_user, 'agenda_adiantada', 'Horário adiantado ✅',
      format('%s aceitou vir às %s.',
             coalesce(cliente_nome, 'A cliente'),
             to_char(oferta.proposed_start_time, 'HH24:MI')),
      '/pro', jsonb_build_object('appointment_id', appt.id), null
    );
  end if;

  return 'aceita';
end;
$$;

-- -------------------------------------------------------------
-- 3. A vaga oferecida precisa lembrar a janela inteira que abriu
--
-- Antes a vaga era re-oferecida com a duração do serviço de quem
-- recusou: a cada recusa a janela encolhia e quem tinha serviço mais
-- longo era pulada para sempre.
-- -------------------------------------------------------------
alter table public.waitlist_offers
  add column if not exists slot_end_time time;

update public.waitlist_offers set slot_end_time = end_time where slot_end_time is null;

-- -------------------------------------------------------------
-- 4. A vaga guardada fica realmente reservada
--
-- Enquanto está guardada com alguém, ela some da grade pública.
-- -------------------------------------------------------------
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
    and a.status not in ('cancelado', 'faltou')
  union all
  select o.start_time, o.end_time
  from public.waitlist_offers o
  join public.waitlist_entries e on e.id = o.entry_id
  where o.date = dia
    and e.professional_id = prof
    and o.status = 'pendente'
    and o.expires_at > now();
$$;

grant execute on function public.get_busy_slots(date, uuid) to anon, authenticated;

-- -------------------------------------------------------------
-- 5. Oferta de vaga: por PESSOA, não por entrada da fila
-- -------------------------------------------------------------
create or replace function public.ofertar_vaga(
  prof uuid,
  dia date,
  inicio time,
  fim time
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  entrada public.waitlist_entries%rowtype;
  cfg public.professionals%rowtype;
  duracao_servico integer;
  agora timestamp := public.agora_local();
  oferta_id uuid;
  serv_nome text;
begin
  select * into cfg from public.professionals where id = prof;
  if not found then
    return null;
  end if;

  if (dia + inicio) < agora + make_interval(mins => cfg.waitlist_min_notice_minutes) then
    return null;
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = prof and a.date = dia
      and a.status not in ('cancelado', 'faltou')
      and inicio < a.end_time and fim > a.start_time
  ) then
    return null;
  end if;

  -- alguém já está com esta vaga guardada
  if exists (
    select 1 from public.waitlist_offers o
    join public.waitlist_entries e on e.id = o.entry_id
    where e.professional_id = prof and o.date = dia
      and o.status = 'pendente' and o.expires_at > now()
      and inicio < o.end_time and fim > o.start_time
  ) then
    return null;
  end if;

  select e.* into entrada
  from public.waitlist_entries e
  join public.services s on s.id = e.service_id
  where e.professional_id = prof
    and e.status = 'aguardando'
    and dia between e.date_from and e.date_to
    and inicio >= e.window_start
    and (inicio + make_interval(mins => s.duration_minutes)) <= e.window_end
    and (inicio + make_interval(mins => s.duration_minutes)) <= fim
    -- a mesma PESSOA não recebe a mesma vaga duas vezes
    and not exists (
      select 1 from public.waitlist_offers o
      join public.waitlist_entries e2 on e2.id = o.entry_id
      where e2.client_id = e.client_id and o.date = dia and o.start_time = inicio
    )
    -- nem tem duas ofertas abertas ao mesmo tempo
    and not exists (
      select 1 from public.waitlist_offers o
      join public.waitlist_entries e3 on e3.id = o.entry_id
      where e3.client_id = e.client_id
        and o.status = 'pendente' and o.expires_at > now()
    )
  order by e.created_at
  limit 1;

  if not found then
    return null;
  end if;

  select duration_minutes, name into duracao_servico, serv_nome
  from public.services where id = entrada.service_id;

  insert into public.waitlist_offers
    (entry_id, date, start_time, end_time, slot_end_time, expires_at)
  values (
    entrada.id, dia, inicio,
    (inicio + make_interval(mins => duracao_servico))::time,
    fim,
    least(
      now() + make_interval(mins => cfg.waitlist_hold_minutes),
      now() + greatest(interval '1 minute', (dia + inicio) - agora - interval '5 minutes')
    )
  )
  returning id into oferta_id;

  perform public.notificar(
    entrada.client_id,
    'vaga_disponivel',
    'Abriu uma vaga! 🎉',
    format('%s tem %s livre dia %s às %s. A vaga fica guardada para você por %s minutos.',
           cfg.name, coalesce(serv_nome, 'o serviço'),
           to_char(dia, 'DD/MM'), to_char(inicio, 'HH24:MI'),
           cfg.waitlist_hold_minutes),
    '/',
    jsonb_build_object('offer_id', oferta_id, 'entry_id', entrada.id),
    now() + make_interval(mins => cfg.waitlist_hold_minutes)
  );

  return oferta_id;
end;
$$;

revoke execute on function public.ofertar_vaga(uuid, date, time, time)
  from public, anon, authenticated;

-- -------------------------------------------------------------
-- 6. Recusar / sair da fila devolve a JANELA INTEIRA para a próxima
-- -------------------------------------------------------------
create or replace function public.responder_vaga(oferta_id uuid, aceitar boolean)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.waitlist_offers%rowtype;
  entrada public.waitlist_entries%rowtype;
  prof_user uuid;
  cliente_nome text;
  janela_fim time;
  agora timestamp := public.agora_local();
begin
  select * into oferta from public.waitlist_offers where id = oferta_id;
  if not found then
    raise exception 'Oferta não encontrada';
  end if;

  select * into entrada from public.waitlist_entries where id = oferta.entry_id;

  if entrada.client_id <> auth.uid() then
    raise exception 'Esta vaga não é sua';
  end if;

  if oferta.status <> 'pendente' then
    raise exception 'Esta vaga já foi respondida';
  end if;

  janela_fim := coalesce(oferta.slot_end_time, oferta.end_time);

  if oferta.expires_at <= now() or (oferta.date + oferta.start_time) <= agora then
    update public.waitlist_offers set status = 'expirada' where id = oferta_id;
    perform public.ofertar_vaga(entrada.professional_id, oferta.date, oferta.start_time, janela_fim);
    return 'expirada';
  end if;

  if not aceitar then
    update public.waitlist_offers set status = 'recusada' where id = oferta_id;
    perform public.ofertar_vaga(entrada.professional_id, oferta.date, oferta.start_time, janela_fim);
    return 'recusada';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = entrada.professional_id and a.date = oferta.date
      and a.status not in ('cancelado', 'faltou')
      and oferta.start_time < a.end_time and oferta.end_time > a.start_time
  ) then
    update public.waitlist_offers set status = 'expirada' where id = oferta_id;
    return 'conflito';
  end if;

  insert into public.appointments
    (client_id, professional_id, service_id, date, start_time, end_time, status)
  values
    (entrada.client_id, entrada.professional_id, entrada.service_id,
     oferta.date, oferta.start_time, oferta.end_time, 'confirmado');

  update public.waitlist_offers set status = 'aceita' where id = oferta_id;
  update public.waitlist_entries set status = 'convertida' where id = entrada.id;

  select user_id into prof_user from public.professionals where id = entrada.professional_id;
  select full_name into cliente_nome from public.profiles where id = entrada.client_id;

  if prof_user is not null then
    perform public.notificar(
      prof_user, 'novo_agendamento', 'Vaga preenchida pela lista de espera 🎉',
      format('%s pegou o horário de %s às %s.',
             coalesce(cliente_nome, 'Uma cliente'),
             to_char(oferta.date, 'DD/MM'), to_char(oferta.start_time, 'HH24:MI')),
      '/pro', jsonb_build_object('date', oferta.date), null
    );
  end if;

  return 'aceita';
end;
$$;

create or replace function public.sair_lista_espera(entrada_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  entrada public.waitlist_entries%rowtype;
  o record;
begin
  select * into entrada from public.waitlist_entries where id = entrada_id;
  if not found or entrada.client_id <> auth.uid() then
    raise exception 'Esta fila não é sua';
  end if;

  update public.waitlist_entries
  set status = 'cancelada'
  where id = entrada_id and status = 'aguardando';

  -- se ela estava segurando uma vaga, a vaga vai para a próxima
  for o in
    select id, date, start_time, coalesce(slot_end_time, end_time) as janela_fim
    from public.waitlist_offers
    where entry_id = entrada_id and status = 'pendente'
  loop
    update public.waitlist_offers set status = 'recusada' where id = o.id;
    perform public.ofertar_vaga(entrada.professional_id, o.date, o.start_time, o.janela_fim);
  end loop;
end;
$$;

create or replace function public.avancar_ofertas_expiradas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  o record;
  n integer := 0;
begin
  for o in
    select wo.id, wo.date, wo.start_time,
           coalesce(wo.slot_end_time, wo.end_time) as janela_fim,
           we.professional_id
    from public.waitlist_offers wo
    join public.waitlist_entries we on we.id = wo.entry_id
    where wo.status = 'pendente' and wo.expires_at <= now()
    limit 50
  loop
    update public.waitlist_offers set status = 'expirada' where id = o.id;
    perform public.ofertar_vaga(o.professional_id, o.date, o.start_time, o.janela_fim);
    n := n + 1;
  end loop;

  update public.waitlist_entries
  set status = 'expirada'
  where status = 'aguardando' and date_to < public.agora_local()::date;

  return n;
end;
$$;

-- -------------------------------------------------------------
-- 7. A profissional enxerga quem está na fila dela
-- -------------------------------------------------------------
drop policy if exists "profissional ve quem espera" on public.profiles;
create policy "profissional ve quem espera"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.waitlist_entries w
      where w.client_id = profiles.id
        and w.status = 'aguardando'
        and public.is_professional(w.professional_id)
    )
  );

-- -------------------------------------------------------------
-- 8. Saldo nunca fica negativo
--
-- O crédito ganho expira, mas o uso não: quando o lançamento
-- original vencia, a cliente ficava com saldo negativo eterno.
-- -------------------------------------------------------------
create or replace function public.saldo_creditos(cliente uuid default auth.uid())
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if cliente is null then
    return 0;
  end if;
  if not (
    cliente = auth.uid()
    or public.is_admin()
    or public.atende_esta_cliente(cliente)
  ) then
    raise exception 'Sem permissão para ver este saldo';
  end if;

  return greatest(0, (
    select coalesce(sum(amount_cents), 0)::integer
    from public.credit_transactions
    where client_id = cliente
      and (expires_at is null or expires_at > now())
  ));
end;
$$;

grant execute on function public.saldo_creditos(uuid) to authenticated;

-- -------------------------------------------------------------
-- 9. Crédito de indicação: uma vez só, mês local, e o bônus da
--    indicada não morre por causa do teto de quem indicou
-- -------------------------------------------------------------
create or replace function public.creditar_indicacao_se_couber()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ind public.referrals%rowtype;
  cfg public.referral_settings%rowtype;
  premiados_no_mes integer;
  nome_indicada text;
  nome_indicou text;
  validade timestamptz;
  paga_indicador boolean := true;
begin
  if new.status <> 'concluido' or old.status = 'concluido' then
    return new;
  end if;

  -- concluir é ato da profissional ou do salão
  if not (public.is_admin() or public.is_professional(new.professional_id)) then
    return new;
  end if;

  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return new;
  end if;

  -- trava atômica: quem pegar a linha 'pendente' primeiro é quem credita
  update public.referrals
  set status = 'creditada', credited_at = now(), appointment_id = new.id
  where referred_id = new.client_id and status = 'pendente'
  returning * into ind;

  if not found then
    return new;
  end if;

  -- precisa ser o PRIMEIRO atendimento concluído dela
  if exists (
    select 1 from public.appointments
    where client_id = new.client_id and status = 'concluido' and id <> new.id
  ) then
    update public.referrals
    set status = 'bloqueada', credited_at = null, appointment_id = null,
        motivo_bloqueio = 'nao era o primeiro atendimento'
    where id = ind.id;
    return new;
  end if;

  -- teto mensal de quem indica, no mês local
  select count(*) into premiados_no_mes
  from public.referrals
  where referrer_id = ind.referrer_id
    and status = 'creditada'
    and id <> ind.id
    and (credited_at at time zone 'America/Sao_Paulo')
        >= date_trunc('month', public.agora_local());

  if premiados_no_mes >= cfg.max_premios_por_mes then
    paga_indicador := false;
  end if;

  select full_name into nome_indicada from public.profiles where id = ind.referred_id;
  select full_name into nome_indicou from public.profiles where id = ind.referrer_id;
  validade := now() + make_interval(days => cfg.validade_dias);

  if paga_indicador and cfg.premio_indicou_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referrer_id, cfg.premio_indicou_cents, 'indicacao',
            format('Indicação de %s', coalesce(nome_indicada, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referrer_id, 'indicacao_creditada', 'Seu crédito chegou! 🎁',
      format('%s fez o primeiro atendimento e você ganhou %s de crédito.',
             coalesce(nome_indicada, 'Sua indicada'),
             to_char(cfg.premio_indicou_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  -- o bônus da indicada vale mesmo se quem indicou bateu o teto
  if cfg.premio_indicada_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referred_id, cfg.premio_indicada_cents, 'indicacao_bonus',
            format('Bônus de boas-vindas (indicada por %s)', coalesce(nome_indicou, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referred_id, 'indicacao_creditada', 'Bônus de boas-vindas 🎁',
      format('Você ganhou %s de crédito para o próximo atendimento.',
             to_char(cfg.premio_indicada_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  if not paga_indicador then
    update public.referrals
    set motivo_bloqueio = 'teto mensal de quem indicou'
    where id = ind.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.creditar_indicacao_se_couber()
  from public, anon, authenticated;

-- -------------------------------------------------------------
-- 10. Tolerância de falta vem da configuração da profissional
-- -------------------------------------------------------------
create or replace function public.config_agenda_profissional(prof uuid)
returns table (
  no_show_tolerance_minutes integer,
  waitlist_hold_minutes integer,
  waitlist_min_notice_minutes integer,
  agora timestamp
)
language sql
stable
security definer set search_path = public
as $$
  select p.no_show_tolerance_minutes,
         p.waitlist_hold_minutes,
         p.waitlist_min_notice_minutes,
         public.agora_local()
  from public.professionals p
  where p.id = prof;
$$;

grant execute on function public.config_agenda_profissional(uuid) to authenticated;

-- =============================================================
-- >>> 015_saloes.sql
-- =============================================================

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
drop policy if exists "admin ve clientes do salao" on public.profiles;
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

-- =============================================================
-- >>> 016_agenda_real.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 016: a agenda diz a verdade do dia
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 015).
--
-- Almoço, folga e compromisso; tempo de arrumação entre
-- atendimentos; encaixe manual de cliente que não usa o app;
-- preço congelado no atendimento; e perdoar uma falta.
-- =============================================================

-- 1. Almoço, folga e compromisso -----------------------------------------
create table if not exists public.professional_blocks (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  -- 'semanal' = todo dia da semana (almoço, folga fixa)
  -- 'data'    = um dia específico (médico, viagem, feriado)
  kind text not null check (kind in ('semanal', 'data')),
  weekday smallint check (weekday between 0 and 6),
  date date,
  all_day boolean not null default false,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz not null default now(),
  check (kind <> 'semanal' or weekday is not null),
  check (kind <> 'data' or date is not null),
  check (all_day or (start_time is not null and end_time is not null and end_time > start_time))
);

create index if not exists blocks_prof_idx
  on public.professional_blocks (professional_id, kind, weekday, date);

alter table public.professional_blocks enable row level security;

-- a grade pública precisa saber o que está bloqueado
drop policy if exists "ver bloqueios" on public.professional_blocks;
create policy "ver bloqueios"
  on public.professional_blocks for select
  to anon, authenticated using (true);

drop policy if exists "equipe gerencia bloqueios" on public.professional_blocks;
create policy "equipe gerencia bloqueios"
  on public.professional_blocks for all
  to authenticated
  using (
    public.is_professional(professional_id)
    or public.is_admin_do_salao(
      (select salon_id from public.professionals where id = professional_id))
  )
  with check (
    public.is_professional(professional_id)
    or public.is_admin_do_salao(
      (select salon_id from public.professionals where id = professional_id))
  );

-- 2. Tempo de arrumação entre atendimentos -------------------------------
alter table public.professionals
  add column if not exists buffer_minutes integer not null default 0
    check (buffer_minutes between 0 and 120);

-- 3. Cliente que não usa o app (encaixe manual) --------------------------
alter table public.appointments alter column client_id drop not null;
alter table public.appointments add column if not exists guest_name text;
alter table public.appointments add column if not exists guest_phone text;
alter table public.appointments drop constraint if exists appointments_tem_cliente;
alter table public.appointments
  add constraint appointments_tem_cliente
  check (client_id is not null or guest_name is not null) not valid;

-- 4. Preço congelado no momento do atendimento ---------------------------
alter table public.appointments add column if not exists price_cents integer;
alter table public.appointments add column if not exists service_name text;

-- histórico antigo recebe o preço atual do serviço (melhor que nada)
update public.appointments a
set price_cents = round(s.price * 100)::integer,
    service_name = s.name
from public.services s
where s.id = a.service_id and a.price_cents is null;

create or replace function public.congela_preco_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.price_cents is null or new.service_name is null then
    select round(price * 100)::integer, name
      into new.price_cents, new.service_name
    from public.services where id = new.service_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.congela_preco_agendamento() from public, anon, authenticated;

drop trigger if exists on_congela_preco on public.appointments;
create trigger on_congela_preco
  before insert on public.appointments
  for each row execute function public.congela_preco_agendamento();

-- 5. A grade passa a considerar bloqueio e arrumação ---------------------
create or replace function public.get_busy_slots(dia date, prof uuid)
returns table (start_time time, end_time time)
language sql
stable
security definer set search_path = public
as $$
  with cfg as (
    select coalesce(buffer_minutes, 0) as buffer from public.professionals where id = prof
  ),
  expediente as (
    select h.start_time as abre, h.end_time as fecha
    from public.professional_hours h
    where h.professional_id = prof
      and h.weekday = extract(dow from dia)
  )
  -- atendimentos, esticados pelo tempo de arrumação
  select a.start_time,
         least(
           (a.end_time + make_interval(mins => (select buffer from cfg)))::time,
           coalesce((select fecha from expediente), '23:59'::time)
         )
  from public.appointments a
  where a.date = dia
    and a.professional_id = prof
    and a.status not in ('cancelado', 'faltou')

  union all

  -- vagas guardadas para quem está na fila
  select o.start_time, o.end_time
  from public.waitlist_offers o
  join public.waitlist_entries e on e.id = o.entry_id
  where o.date = dia
    and e.professional_id = prof
    and o.status = 'pendente'
    and o.expires_at > now()

  union all

  -- almoço, folga e compromissos
  select
    case when b.all_day then coalesce((select abre from expediente), '00:00'::time)
         else b.start_time end,
    case when b.all_day then coalesce((select fecha from expediente), '23:59'::time)
         else b.end_time end
  from public.professional_blocks b
  where b.professional_id = prof
    and (
      (b.kind = 'semanal' and b.weekday = extract(dow from dia))
      or (b.kind = 'data' and b.date = dia)
    );
$$;

grant execute on function public.get_busy_slots(date, uuid) to anon, authenticated;

-- 6. Encaixe manual ------------------------------------------------------
create or replace function public.encaixar_atendimento(
  prof uuid,
  servico uuid,
  dia date,
  inicio time,
  nome_cliente text default null,
  telefone text default null,
  cliente uuid default null,
  duracao_min integer default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  salao uuid;
  duracao integer;
  fim time;
  novo_id uuid;
begin
  select salon_id into salao from public.professionals where id = prof;
  if salao is null then
    raise exception 'Profissional não encontrada';
  end if;

  if not (public.is_professional(prof) or public.is_admin_do_salao(salao)) then
    raise exception 'Só a profissional ou o salão podem encaixar';
  end if;

  if cliente is null and coalesce(trim(nome_cliente), '') = '' then
    raise exception 'Informe o nome da cliente';
  end if;

  select duration_minutes into duracao from public.services where id = servico;
  if duracao is null then
    raise exception 'Serviço não encontrado';
  end if;
  duracao := coalesce(duracao_min, duracao);
  fim := inicio + make_interval(mins => duracao);

  -- o encaixe pode furar a grade de 30 em 30, mas nunca sobrepor
  if exists (
    select 1 from public.appointments a
    where a.professional_id = prof and a.date = dia
      and a.status not in ('cancelado', 'faltou')
      and inicio < a.end_time and fim > a.start_time
  ) then
    raise exception 'Esse horário conflita com outro atendimento';
  end if;

  insert into public.appointments
    (client_id, professional_id, service_id, date, start_time, end_time,
     status, guest_name, guest_phone)
  values
    (cliente, prof, servico, dia, inicio, fim, 'confirmado',
     case when cliente is null then trim(nome_cliente) else null end,
     case when cliente is null then nullif(trim(telefone), '') else null end)
  returning id into novo_id;

  return novo_id;
end;
$$;

grant execute on function public.encaixar_atendimento(uuid, uuid, date, time, text, text, uuid, integer) to authenticated;

-- 7. Perdoar uma falta ---------------------------------------------------
create or replace function public.perdoar_falta(appt_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_professional(appt.professional_id)
          or public.is_admin_do_salao(appt.salon_id)) then
    raise exception 'Sem permissão';
  end if;

  if appt.status <> 'faltou' then
    raise exception 'Este atendimento não está marcado como falta';
  end if;

  -- a vaga pode ter sido ocupada por outra pessoa nesse meio-tempo
  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id and a.date = appt.date
      and a.id <> appt.id
      and a.status not in ('cancelado', 'faltou')
      and appt.start_time < a.end_time and appt.end_time > a.start_time
  ) then
    return 'ocupado';
  end if;

  update public.appointments set status = 'confirmado' where id = appt_id;
  return 'perdoada';
end;
$$;

grant execute on function public.perdoar_falta(uuid) to authenticated;

-- 8. O crédito de indicação não quebra com cliente sem conta -------------
create or replace function public.creditar_indicacao_se_couber()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ind public.referrals%rowtype;
  cfg public.referral_settings%rowtype;
  premiados_no_mes integer;
  nome_indicada text;
  nome_indicou text;
  validade timestamptz;
  paga_indicador boolean := true;
begin
  if new.status <> 'concluido' or old.status = 'concluido' then
    return new;
  end if;

  -- encaixe de cliente sem conta não gera indicação
  if new.client_id is null then
    return new;
  end if;

  if not (public.is_admin_do_salao(new.salon_id)
          or public.is_professional(new.professional_id)) then
    return new;
  end if;

  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return new;
  end if;

  update public.referrals
  set status = 'creditada', credited_at = now(), appointment_id = new.id
  where referred_id = new.client_id and status = 'pendente'
  returning * into ind;

  if not found then
    return new;
  end if;

  if exists (
    select 1 from public.appointments
    where client_id = new.client_id and status = 'concluido' and id <> new.id
  ) then
    update public.referrals
    set status = 'bloqueada', credited_at = null, appointment_id = null,
        motivo_bloqueio = 'nao era o primeiro atendimento'
    where id = ind.id;
    return new;
  end if;

  select count(*) into premiados_no_mes
  from public.referrals
  where referrer_id = ind.referrer_id
    and status = 'creditada'
    and id <> ind.id
    and (credited_at at time zone 'America/Sao_Paulo')
        >= date_trunc('month', public.agora_local());

  if premiados_no_mes >= cfg.max_premios_por_mes then
    paga_indicador := false;
  end if;

  select full_name into nome_indicada from public.profiles where id = ind.referred_id;
  select full_name into nome_indicou from public.profiles where id = ind.referrer_id;
  validade := now() + make_interval(days => cfg.validade_dias);

  if paga_indicador and cfg.premio_indicou_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referrer_id, cfg.premio_indicou_cents, 'indicacao',
            format('Indicação de %s', coalesce(nome_indicada, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referrer_id, 'indicacao_creditada', 'Seu crédito chegou! 🎁',
      format('%s fez o primeiro atendimento e você ganhou %s de crédito.',
             coalesce(nome_indicada, 'Sua indicada'),
             to_char(cfg.premio_indicou_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  if cfg.premio_indicada_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referred_id, cfg.premio_indicada_cents, 'indicacao_bonus',
            format('Bônus de boas-vindas (indicada por %s)', coalesce(nome_indicou, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referred_id, 'indicacao_creditada', 'Bônus de boas-vindas 🎁',
      format('Você ganhou %s de crédito para o próximo atendimento.',
             to_char(cfg.premio_indicada_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  if not paga_indicador then
    update public.referrals set motivo_bloqueio = 'teto mensal de quem indicou'
    where id = ind.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.creditar_indicacao_se_couber() from public, anon, authenticated;

-- 9. O abatimento de crédito usa o preço congelado -----------------------
create or replace function public.usar_credito(appt_id uuid, valor_cents integer)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  saldo integer;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin_do_salao(appt.salon_id)
          or public.is_professional(appt.professional_id)) then
    raise exception 'Só a profissional do atendimento pode abater crédito';
  end if;

  if appt.client_id is null then
    raise exception 'Cliente sem conta no app não tem carteira de crédito';
  end if;

  if valor_cents <= 0 then
    raise exception 'Valor inválido';
  end if;

  saldo := public.saldo_creditos(appt.client_id);
  if valor_cents > saldo then
    raise exception 'Crédito insuficiente';
  end if;

  if appt.price_cents is not null and valor_cents > appt.price_cents then
    raise exception 'O abatimento não pode passar do valor do atendimento';
  end if;

  if exists (
    select 1 from public.credit_transactions
    where appointment_id = appt_id and kind = 'uso'
  ) then
    raise exception 'Este atendimento já teve crédito abatido';
  end if;

  insert into public.credit_transactions
    (client_id, amount_cents, kind, description, appointment_id)
  values (appt.client_id, -valor_cents, 'uso', 'Abatido no atendimento', appt_id);

  perform public.notificar(
    appt.client_id, 'indicacao_creditada', 'Crédito usado',
    format('Abatemos %s no seu atendimento.',
           to_char(valor_cents / 100.0, 'FM999G990D00')),
    '/indique', jsonb_build_object('appointment_id', appt_id), null
  );

  return public.saldo_creditos(appt.client_id);
end;
$$;

grant execute on function public.usar_credito(uuid, integer) to authenticated;

-- =============================================================
-- >>> 017_afiliados.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 017: indicação inversa (cliente traz profissional)
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 016).
--
-- A cliente que traz uma profissional vira AFILIADA dela: enquanto
-- essa profissional usar o app, uma fatia da taxa que a plataforma
-- cobra vai para a cliente, em cashback.
--
-- Se a taxa é 3% e o repasse é 0,5 ponto, a plataforma fica com 2,5
-- e a cliente com 0,5. Tudo em pontos-base (bps) e centavos, com
-- número inteiro — dinheiro nunca em ponto flutuante.
--
-- O pagamento ainda não existe. O que entra aqui é a ATRIBUIÇÃO
-- (quem trouxe quem, de forma permanente) e o livro-razão que vai
-- receber as transações quando o pagamento chegar.
-- =============================================================

-- 1. Regras do programa ---------------------------------------------------
create table if not exists public.affiliate_settings (
  id boolean primary key default true check (id),
  ativo boolean not null default true,
  -- taxa que a plataforma cobra sobre a transação (300 = 3,00%)
  platform_fee_bps integer not null default 300 check (platform_fee_bps between 0 and 10000),
  -- quanto dessa taxa vai para quem indicou (50 = 0,50%)
  affiliate_share_bps integer not null default 50 check (affiliate_share_bps between 0 and 10000),
  -- por quantos meses a cliente recebe; null = enquanto a profissional usar
  duracao_meses integer check (duracao_meses is null or duracao_meses > 0),
  -- teto mensal de cashback por cliente, em centavos (freio de mão)
  teto_mensal_cents integer not null default 50000 check (teto_mensal_cents >= 0),
  check (affiliate_share_bps <= platform_fee_bps)
);

insert into public.affiliate_settings (id) values (true) on conflict do nothing;

alter table public.affiliate_settings enable row level security;

drop policy if exists "ver regras de afiliado" on public.affiliate_settings;
create policy "ver regras de afiliado"
  on public.affiliate_settings for select
  to anon, authenticated using (true);

-- 2. A atribuição: quem trouxe quem, para sempre -------------------------
-- Uma linha por profissional e uma por salão. Existir a linha JÁ
-- fecha a porta: quem entrou direto ganha linha com indicante nulo,
-- e nunca mais pode ser atribuída a um link.
create table if not exists public.affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('salao', 'profissional')),
  salon_id uuid references public.salons (id) on delete cascade,
  professional_id uuid references public.professionals (id) on delete cascade,
  -- quem indicou; nulo = entrou direto (a porta fecha do mesmo jeito)
  referrer_client_id uuid references public.profiles (id) on delete set null,
  code text,
  status text not null default 'ativa'
    check (status in ('ativa', 'direta', 'bloqueada', 'encerrada')),
  motivo text,
  created_at timestamptz not null default now(),
  -- quando a profissional começou a usar de fato
  first_activity_at timestamptz,
  expires_at timestamptz,
  check (
    (kind = 'salao' and salon_id is not null and professional_id is null)
    or (kind = 'profissional' and professional_id is not null and salon_id is null)
  )
);

create unique index if not exists atribuicao_salao_unica
  on public.affiliate_attributions (salon_id) where salon_id is not null;

create unique index if not exists atribuicao_prof_unica
  on public.affiliate_attributions (professional_id) where professional_id is not null;

create index if not exists atribuicao_indicante_idx
  on public.affiliate_attributions (referrer_client_id, status);

-- 3. Livro-razão: o que a plataforma cobrou ------------------------------
create table if not exists public.platform_transactions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete restrict,
  professional_id uuid references public.professionals (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  -- quanto a cliente pagou pelo atendimento
  amount_cents integer not null check (amount_cents > 0),
  -- a taxa da plataforma naquele momento (congelada, como o preço)
  platform_fee_bps integer not null,
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  status text not null default 'liquidada'
    check (status in ('pendente', 'liquidada', 'estornada')),
  -- 'pagamento' quando vier do gateway; 'manual' enquanto não existe
  origem text not null default 'manual' check (origem in ('manual', 'pagamento')),
  occurred_at timestamptz not null default now()
);

create index if not exists transacoes_salao_idx
  on public.platform_transactions (salon_id, occurred_at desc);

create unique index if not exists transacao_por_atendimento
  on public.platform_transactions (appointment_id)
  where appointment_id is not null and status <> 'estornada';

-- 4. A comissão de cada transação ----------------------------------------
create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.platform_transactions (id) on delete cascade,
  attribution_id uuid not null references public.affiliate_attributions (id) on delete cascade,
  affiliate_client_id uuid not null references public.profiles (id) on delete cascade,
  share_bps integer not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'creditada'
    check (status in ('creditada', 'estornada', 'retida')),
  motivo text,
  created_at timestamptz not null default now()
);

create unique index if not exists comissao_por_transacao
  on public.affiliate_commissions (transaction_id);

create index if not exists comissao_afiliada_idx
  on public.affiliate_commissions (affiliate_client_id, created_at desc);

-- 5. O cashback entra na carteira que já existe --------------------------
alter table public.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table public.credit_transactions add constraint credit_transactions_kind_check
  check (kind in ('indicacao', 'indicacao_bonus', 'uso', 'ajuste', 'expiracao', 'afiliado'));

-- 6. Permissões -----------------------------------------------------------
alter table public.affiliate_attributions enable row level security;
alter table public.platform_transactions enable row level security;
alter table public.affiliate_commissions enable row level security;

drop policy if exists "ver minhas atribuicoes" on public.affiliate_attributions;
create policy "ver minhas atribuicoes"
  on public.affiliate_attributions for select
  to authenticated
  using (
    referrer_client_id = auth.uid()
    or public.is_admin_do_salao(salon_id)
    or public.is_professional(professional_id)
  );

drop policy if exists "ver transacoes do salao" on public.platform_transactions;
create policy "ver transacoes do salao"
  on public.platform_transactions for select
  to authenticated
  using (public.is_admin_do_salao(salon_id) or public.is_professional(professional_id));

drop policy if exists "ver minhas comissoes" on public.affiliate_commissions;
create policy "ver minhas comissoes"
  on public.affiliate_commissions for select
  to authenticated
  using (affiliate_client_id = auth.uid());

revoke insert, update, delete on public.affiliate_attributions from authenticated, anon;
revoke insert, update, delete on public.platform_transactions from authenticated, anon;
revoke insert, update, delete on public.affiliate_commissions from authenticated, anon;

-- 7. Fechar a porta: toda profissional e todo salão nascem atribuídos ----
-- Sem indicante, a linha entra como 'direta' — e a exclusividade
-- permanente passa a valer a partir daí.
create or replace function public.fecha_atribuicao_profissional()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.affiliate_attributions (kind, professional_id, status)
  values ('profissional', new.id, 'direta')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_atribuicao_profissional on public.professionals;
create trigger on_atribuicao_profissional
  after insert on public.professionals
  for each row execute function public.fecha_atribuicao_profissional();

create or replace function public.fecha_atribuicao_salao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.affiliate_attributions (kind, salon_id, status)
  values ('salao', new.id, 'direta')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_atribuicao_salao on public.salons;
create trigger on_atribuicao_salao
  after insert on public.salons
  for each row execute function public.fecha_atribuicao_salao();

revoke execute on function public.fecha_atribuicao_profissional() from public, anon, authenticated;
revoke execute on function public.fecha_atribuicao_salao() from public, anon, authenticated;

-- o que já existe entra como 'direta' (ninguém indicou)
insert into public.affiliate_attributions (kind, professional_id, status)
select 'profissional', p.id, 'direta' from public.professionals p
on conflict do nothing;

insert into public.affiliate_attributions (kind, salon_id, status)
select 'salao', s.id, 'direta' from public.salons s
on conflict do nothing;

-- 8. Registrar a indicação de uma profissional ---------------------------
create or replace function public.registrar_indicacao_profissional(
  codigo text,
  salao uuid default null,
  profissional uuid default null
)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  cfg public.affiliate_settings%rowtype;
  quem_indicou public.profiles%rowtype;
  atual public.affiliate_attributions%rowtype;
  dono uuid;
  vence timestamptz;
begin
  select * into cfg from public.affiliate_settings where id;
  if not cfg.ativo then
    return 'programa_inativo';
  end if;

  if auth.uid() is null then
    raise exception 'Entre na sua conta primeiro';
  end if;

  if (salao is null) = (profissional is null) then
    raise exception 'Informe o salão OU a profissional';
  end if;

  -- só quem manda no salão / é dona da ficha pode declarar quem a trouxe
  if salao is not null then
    if not public.is_admin_do_salao(salao) then
      raise exception 'Sem permissão sobre este salão';
    end if;
    select owner_id into dono from public.salons where id = salao;
  else
    if not public.is_professional(profissional) then
      raise exception 'Sem permissão sobre esta ficha';
    end if;
    select user_id into dono from public.professionals where id = profissional;
  end if;

  select * into quem_indicou from public.profiles
  where referral_code = upper(trim(codigo));
  if not found then
    return 'codigo_invalido';
  end if;

  -- ninguém se indica
  if quem_indicou.id = auth.uid() or quem_indicou.id = dono then
    return 'codigo_proprio';
  end if;

  select * into atual from public.affiliate_attributions
  where (salao is not null and salon_id = salao)
     or (profissional is not null and professional_id = profissional);

  -- a porta já está fechada: entrou direto ou já tem quem indicou
  if found and atual.referrer_client_id is not null then
    return 'ja_atribuida';
  end if;
  if found and atual.status <> 'direta' then
    return 'ja_atribuida';
  end if;

  -- só vale enquanto o cadastro é novo: sem transação nenhuma ainda
  if exists (
    select 1 from public.platform_transactions t
    where (salao is not null and t.salon_id = salao)
       or (profissional is not null and t.professional_id = profissional)
  ) then
    return 'cadastro_antigo';
  end if;

  vence := case when cfg.duracao_meses is null then null
                else now() + make_interval(months => cfg.duracao_meses) end;

  update public.affiliate_attributions
  set referrer_client_id = quem_indicou.id,
      code = upper(trim(codigo)),
      status = 'ativa',
      expires_at = vence
  where id = atual.id;

  perform public.notificar(
    quem_indicou.id,
    'afiliado_novo',
    'Você trouxe uma profissional! 💼',
    'A partir de agora você recebe uma parte da taxa do app sempre que ela atender pelo aplicativo.',
    '/indique',
    jsonb_build_object('attribution_id', atual.id),
    null
  );

  return 'registrada';
end;
$$;

grant execute on function public.registrar_indicacao_profissional(text, uuid, uuid) to authenticated;

-- 9. Registrar uma transação e repartir a taxa ---------------------------
-- Enquanto o pagamento não existe, esta função é chamada à mão pelo
-- salão (origem 'manual'). Quando o gateway entrar, o webhook chama a
-- mesma função com origem 'pagamento' — a repartição não muda.
create or replace function public.registrar_transacao(
  appt_id uuid,
  valor_cents integer default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  cfg public.affiliate_settings%rowtype;
  valor integer;
  taxa integer;
  trans_id uuid;
  atrib public.affiliate_attributions%rowtype;
  comissao integer;
  ja_no_mes integer;
  nome_prof text;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin_do_salao(appt.salon_id)
          or public.is_professional(appt.professional_id)) then
    raise exception 'Sem permissão';
  end if;

  if appt.status <> 'concluido' then
    raise exception 'A transação só entra depois do atendimento concluído';
  end if;

  select * into cfg from public.affiliate_settings where id;
  valor := coalesce(valor_cents, appt.price_cents);
  if valor is null or valor <= 0 then
    raise exception 'Valor do atendimento não informado';
  end if;

  taxa := (valor * cfg.platform_fee_bps) / 10000;

  insert into public.platform_transactions
    (salon_id, professional_id, appointment_id, amount_cents,
     platform_fee_bps, platform_fee_cents)
  values (appt.salon_id, appt.professional_id, appt.id, valor,
          cfg.platform_fee_bps, taxa)
  returning id into trans_id;

  if not cfg.ativo then
    return trans_id;
  end if;

  -- a atribuição da profissional vale mais que a do salão
  select * into atrib from public.affiliate_attributions
  where professional_id = appt.professional_id
    and status = 'ativa' and referrer_client_id is not null;

  if not found then
    select * into atrib from public.affiliate_attributions
    where salon_id = appt.salon_id
      and status = 'ativa' and referrer_client_id is not null;
  end if;

  if not found then
    return trans_id;
  end if;

  if atrib.expires_at is not null and atrib.expires_at <= now() then
    update public.affiliate_attributions set status = 'encerrada' where id = atrib.id;
    return trans_id;
  end if;

  comissao := (valor * cfg.affiliate_share_bps) / 10000;
  if comissao <= 0 then
    return trans_id;
  end if;

  -- teto mensal por afiliada
  select coalesce(sum(amount_cents), 0) into ja_no_mes
  from public.affiliate_commissions
  where affiliate_client_id = atrib.referrer_client_id
    and status = 'creditada'
    and created_at >= date_trunc('month', now());

  if ja_no_mes >= cfg.teto_mensal_cents then
    insert into public.affiliate_commissions
      (transaction_id, attribution_id, affiliate_client_id, share_bps, amount_cents, status, motivo)
    values (trans_id, atrib.id, atrib.referrer_client_id,
            cfg.affiliate_share_bps, 0, 'retida', 'teto mensal atingido');
    return trans_id;
  end if;

  comissao := least(comissao, cfg.teto_mensal_cents - ja_no_mes);

  insert into public.affiliate_commissions
    (transaction_id, attribution_id, affiliate_client_id, share_bps, amount_cents)
  values (trans_id, atrib.id, atrib.referrer_client_id,
          cfg.affiliate_share_bps, comissao);

  -- cashback não expira: é participação em receita, não brinde
  insert into public.credit_transactions
    (client_id, amount_cents, kind, description, appointment_id)
  values (atrib.referrer_client_id, comissao, 'afiliado',
          'Cashback de afiliada', appt.id);

  if atrib.first_activity_at is null then
    update public.affiliate_attributions
    set first_activity_at = now() where id = atrib.id;
  end if;

  select name into nome_prof from public.professionals where id = appt.professional_id;

  perform public.notificar(
    atrib.referrer_client_id,
    'afiliado_cashback',
    'Cashback na conta 💰',
    format('%s atendeu pelo app e você recebeu %s.',
           coalesce(nome_prof, 'Sua indicada'),
           to_char(comissao / 100.0, 'FM999G990D00')),
    '/indique',
    jsonb_build_object('transaction_id', trans_id),
    null
  );

  return trans_id;
end;
$$;

grant execute on function public.registrar_transacao(uuid, integer) to authenticated;

-- 10. Resumo da afiliada --------------------------------------------------
create or replace function public.meu_resumo_afiliada()
returns table (
  profissionais_ativas integer,
  cashback_total_cents integer,
  cashback_mes_cents integer,
  share_bps integer,
  platform_fee_bps integer,
  teto_mensal_cents integer
)
language sql
stable
security definer set search_path = public
as $$
  select
    (select count(*)::integer from public.affiliate_attributions
      where referrer_client_id = auth.uid() and status = 'ativa'),
    (select coalesce(sum(amount_cents), 0)::integer from public.affiliate_commissions
      where affiliate_client_id = auth.uid() and status = 'creditada'),
    (select coalesce(sum(amount_cents), 0)::integer from public.affiliate_commissions
      where affiliate_client_id = auth.uid() and status = 'creditada'
        and created_at >= date_trunc('month', now())),
    s.affiliate_share_bps,
    s.platform_fee_bps,
    s.teto_mensal_cents
  from public.affiliate_settings s where s.id;
$$;

grant execute on function public.meu_resumo_afiliada() to authenticated;

-- quem eu trouxe
create or replace function public.minhas_profissionais_indicadas()
returns table (
  attribution_id uuid,
  nome text,
  slug text,
  tipo text,
  desde timestamptz,
  primeira_atividade timestamptz,
  cashback_cents integer
)
language sql
stable
security definer set search_path = public
as $$
  select
    a.id,
    coalesce(p.name, s.name),
    coalesce(p.slug, s.slug),
    a.kind,
    a.created_at,
    a.first_activity_at,
    (select coalesce(sum(c.amount_cents), 0)::integer
     from public.affiliate_commissions c
     where c.attribution_id = a.id and c.status = 'creditada')
  from public.affiliate_attributions a
  left join public.professionals p on p.id = a.professional_id
  left join public.salons s on s.id = a.salon_id
  where a.referrer_client_id = auth.uid()
    and a.status in ('ativa', 'encerrada')
  order by a.created_at desc;
$$;

grant execute on function public.minhas_profissionais_indicadas() to authenticated;

-- 11. Abrir salão já registrando quem trouxe -----------------------------
create or replace function public.abrir_salao(
  nome text,
  endereco_slug text,
  cidade text default null,
  telefone text default null,
  codigo_indicacao text default null
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

  insert into public.business_hours (salon_id, weekday, open)
  select novo_id, d, d between 1 and 5
  from generate_series(0, 6) as d
  on conflict do nothing;

  update public.profiles set role = 'admin' where id = auth.uid() and role = 'cliente';

  if coalesce(trim(codigo_indicacao), '') <> '' then
    perform public.registrar_indicacao_profissional(codigo_indicacao, novo_id, null);
  end if;

  return novo_id;
end;
$$;

grant execute on function public.abrir_salao(text, text, text, text, text) to authenticated;

-- a versão antiga de abrir_salao sai de cena para não ficar ambígua
drop function if exists public.abrir_salao(text, text, text, text);

-- =============================================================
-- >>> 018_dados_teste.sql
-- =============================================================

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

-- =============================================================
-- >>> 019_volta_sozinha.sql
-- =============================================================

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

-- =============================================================
-- >>> 020_numeros.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 020: saber se o mês fechou no azul
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 019).
--
-- Números que a profissional hoje só tem "de cabeça": quanto
-- entrou, quanto vale um atendimento em média, quantas faltaram,
-- quanto da agenda ficou parada e quem voltou.
--
-- Dinheiro sempre em centavos inteiros; percentual em pontos-base
-- (1234 = 12,34%) — nada de float em cima de dinheiro.
-- =============================================================

-- 1. Quanto tempo a agenda tinha para vender -----------------------------
-- Soma a janela de trabalho de cada dia do período e desconta almoço,
-- folga e compromisso. É o denominador da taxa de ocupação.
create or replace function public.minutos_disponiveis(
  prof uuid,
  de date,
  ate date
)
returns integer
language sql
stable
security definer set search_path = public
as $$
  with dias as (
    select d::date as dia
    from generate_series(de, ate, interval '1 day') d
  ),
  janelas as (
    select dias.dia,
           h.start_time,
           h.end_time,
           extract(epoch from (h.end_time - h.start_time)) / 60 as minutos
    from dias
    join public.professional_hours h
      on h.professional_id = prof
     and h.weekday = extract(dow from dias.dia)::smallint
    where h.open
  ),
  descontos as (
    select j.dia,
           sum(
             case
               when b.all_day then j.minutos
               else greatest(
                 0,
                 extract(epoch from (
                   least(b.end_time, j.end_time) - greatest(b.start_time, j.start_time)
                 )) / 60
               )
             end
           ) as minutos
    from janelas j
    join public.professional_blocks b
      on b.professional_id = prof
     and (
       (b.kind = 'semanal' and b.weekday = extract(dow from j.dia)::smallint)
       or (b.kind = 'data' and b.date = j.dia)
     )
    group by j.dia
  )
  select greatest(
    0,
    coalesce(
      (select sum(j.minutos) from janelas j)
      - (select coalesce(sum(d.minutos), 0) from descontos d),
      0
    )
  )::integer;
$$;

revoke execute on function public.minutos_disponiveis(uuid, date, date)
  from public, anon, authenticated;

-- 2. O mês em números ----------------------------------------------------
create or replace function public.resumo_do_mes(
  prof uuid default public.my_professional_id(),
  mes date default null
)
returns table (
  inicio date,
  fim date,
  atendimentos integer,
  faturamento_cents bigint,
  ticket_medio_cents integer,
  descontos_cents bigint,
  faltas integer,
  cancelamentos integer,
  taxa_falta_bps integer,
  clientes integer,
  clientes_novas integer,
  encaixes integer,
  minutos_ocupados integer,
  minutos_disponiveis integer,
  ocupacao_bps integer,
  faturamento_mes_anterior_cents bigint
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  hoje date := public.agora_local()::date;
  ini date;
  fin date;
  ate date;
  ini_ant date;
  fim_ant date;
  concluidos integer;
  faltou integer;
begin
  if prof is null then
    raise exception 'Informe a profissional';
  end if;

  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;

  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, hoje))::date;
  fin := (ini + interval '1 month - 1 day')::date;
  -- no mês corrente a agenda ainda não aconteceu inteira
  ate := least(fin, hoje);
  ini_ant := (ini - interval '1 month')::date;
  fim_ant := (ini - interval '1 day')::date;

  select count(*) filter (where a.status = 'concluido'),
         count(*) filter (where a.status = 'faltou')
    into concluidos, faltou
  from public.appointments a
  where a.professional_id = prof and a.date between ini and fin;

  return query
  select
    ini,
    fin,
    concluidos,
    coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)::bigint,
    case when concluidos > 0
      then (coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)
            / concluidos)::integer
      else 0 end,
    coalesce((
      select -sum(ct.amount_cents)
      from public.credit_transactions ct
      join public.appointments ap on ap.id = ct.appointment_id
      where ct.kind = 'uso'
        and ap.professional_id = prof
        and ap.date between ini and fin
    ), 0)::bigint,
    faltou,
    count(*) filter (where a.status = 'cancelado')::integer,
    case when (concluidos + faltou) > 0
      then ((faltou::numeric * 10000) / (concluidos + faltou))::integer
      else 0 end,
    count(distinct a.client_id) filter (where a.status = 'concluido')::integer,
    count(distinct a.client_id) filter (
      where a.status = 'concluido'
        and not exists (
          select 1 from public.appointments ant
          where ant.professional_id = prof
            and ant.client_id = a.client_id
            and ant.status = 'concluido'
            and ant.date < ini
        )
    )::integer,
    count(*) filter (where a.status = 'concluido' and a.client_id is null)::integer,
    coalesce(sum(
      extract(epoch from (a.end_time - a.start_time)) / 60
    ) filter (where a.status = 'concluido'), 0)::integer,
    public.minutos_disponiveis(prof, ini, ate),
    case when public.minutos_disponiveis(prof, ini, ate) > 0
      then least(10000, ((coalesce(sum(
             extract(epoch from (a.end_time - a.start_time)) / 60
           ) filter (where a.status = 'concluido'), 0) * 10000)
           / public.minutos_disponiveis(prof, ini, ate))::integer)
      else 0 end,
    coalesce((
      select sum(ant.price_cents)
      from public.appointments ant
      where ant.professional_id = prof
        and ant.status = 'concluido'
        and ant.date between ini_ant and fim_ant
    ), 0)::bigint
  from public.appointments a
  where a.professional_id = prof and a.date between ini and fin;
end;
$$;

revoke execute on function public.resumo_do_mes(uuid, date) from public, anon;
grant execute on function public.resumo_do_mes(uuid, date) to authenticated;

-- 3. O que mais rendeu ---------------------------------------------------
create or replace function public.faturamento_por_servico(
  prof uuid default public.my_professional_id(),
  mes date default null
)
returns table (
  servico text,
  quantidade integer,
  total_cents bigint,
  fatia_bps integer
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  ini date;
  fin date;
  total bigint;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, public.agora_local()::date))::date;
  fin := (ini + interval '1 month - 1 day')::date;

  select coalesce(sum(a.price_cents), 0) into total
  from public.appointments a
  where a.professional_id = prof and a.status = 'concluido'
    and a.date between ini and fin;

  return query
  select coalesce(a.service_name, s.name, 'Sem nome'),
         count(*)::integer,
         coalesce(sum(a.price_cents), 0)::bigint,
         case when total > 0
           then ((coalesce(sum(a.price_cents), 0)::numeric * 10000) / total)::integer
           else 0 end
  from public.appointments a
  left join public.services s on s.id = a.service_id
  where a.professional_id = prof and a.status = 'concluido'
    and a.date between ini and fin
  group by coalesce(a.service_name, s.name, 'Sem nome')
  order by 3 desc;
end;
$$;

revoke execute on function public.faturamento_por_servico(uuid, date) from public, anon;
grant execute on function public.faturamento_por_servico(uuid, date) to authenticated;

-- 4. Quem mais volta -----------------------------------------------------
create or replace function public.melhores_clientes(
  prof uuid default public.my_professional_id(),
  meses integer default 6,
  limite integer default 10
)
returns table (
  client_id uuid,
  nome text,
  visitas integer,
  total_cents bigint,
  ultima_visita date
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  desde date;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  desde := (public.agora_local()::date
            - make_interval(months => greatest(1, least(coalesce(meses, 6), 36))))::date;

  return query
  select a.client_id,
         coalesce(c.full_name, 'Cliente'),
         count(*)::integer,
         coalesce(sum(a.price_cents), 0)::bigint,
         max(a.date)
  from public.appointments a
  join public.profiles c on c.id = a.client_id
  where a.professional_id = prof and a.status = 'concluido' and a.date >= desde
  group by a.client_id, c.full_name
  order by 3 desc, 4 desc
  limit greatest(1, least(coalesce(limite, 10), 50));
end;
$$;

revoke execute on function public.melhores_clientes(uuid, integer, integer) from public, anon;
grant execute on function public.melhores_clientes(uuid, integer, integer) to authenticated;

-- 5. O salão inteiro, uma linha por profissional -------------------------
create or replace function public.resumo_do_salao(
  salao uuid default null,
  mes date default null
)
returns table (
  professional_id uuid,
  nome text,
  atendimentos integer,
  faturamento_cents bigint,
  faltas integer,
  ocupacao_bps integer
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  alvo uuid;
  ini date;
  fin date;
  ate date;
  hoje date := public.agora_local()::date;
begin
  -- meus_saloes() devolve os uuid direto, sem nome de coluna
  alvo := coalesce(salao, (select s from public.meus_saloes() s limit 1));
  if alvo is null then
    raise exception 'Informe o salão';
  end if;
  if not public.is_admin_do_salao(alvo) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, hoje))::date;
  fin := (ini + interval '1 month - 1 day')::date;
  ate := least(fin, hoje);

  return query
  select p.id,
         p.name,
         count(*) filter (where a.status = 'concluido')::integer,
         coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)::bigint,
         count(*) filter (where a.status = 'faltou')::integer,
         case when public.minutos_disponiveis(p.id, ini, ate) > 0
           then least(10000, ((coalesce(sum(
                  extract(epoch from (a.end_time - a.start_time)) / 60
                ) filter (where a.status = 'concluido'), 0) * 10000)
                / public.minutos_disponiveis(p.id, ini, ate))::integer)
           else 0 end
  from public.professionals p
  left join public.appointments a
    on a.professional_id = p.id and a.date between ini and fin
  where p.salon_id = alvo
  group by p.id, p.name
  order by 4 desc;
end;
$$;

revoke execute on function public.resumo_do_salao(uuid, date) from public, anon;
grant execute on function public.resumo_do_salao(uuid, date) to authenticated;

-- =============================================================
-- >>> 021_dados_teste_historico.sql
-- =============================================================

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

-- =============================================================
-- >>> 022_gatilhos.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 022: os gatilhos de verdade
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 021).
--
-- Correção de uma trava que nunca travou.
--
-- O 013 criou o gatilho que impede a cliente de marcar o próprio
-- atendimento como concluído. Ele começa assim:
--
--     if current_user not in ('authenticated', 'anon') then
--       return new;                      -- veio de função do servidor
--     end if;
--
-- Só que a função foi criada como SECURITY DEFINER. Dentro de uma
-- função SECURITY DEFINER, current_user é o DONO da função (postgres),
-- nunca 'authenticated' — então a primeira linha sempre saía fora e o
-- resto do gatilho jamais rodou. Na prática a cliente continuava
-- podendo mandar um PATCH e escrever status = 'concluido'.
--
-- Isso ficou pior agora que os números do mês somam justamente os
-- atendimentos concluídos: seria o faturamento mentindo.
--
-- A correção é uma palavra: SECURITY INVOKER. Aí current_user é
-- 'authenticated' quando a escrita vem da API, e vira o dono da função
-- quando a escrita nasce dentro de uma função nossa — que é
-- exatamente a distinção que o código queria fazer.
--
-- O gatilho não precisa de poder nenhum: ele só lê NEW e OLD e chama
-- is_admin() / is_professional(), que continuam SECURITY DEFINER.
-- =============================================================

-- Quem está falando, sem depender de o papel enxergar o schema auth.
-- O gatilho abaixo roda como SECURITY INVOKER; este atalho é a única
-- coisa nele que precisa de poder.
create or replace function public.meu_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select auth.uid();
$$;

revoke execute on function public.meu_id() from public;
grant execute on function public.meu_id() to anon, authenticated;

create or replace function public.valida_status_agendamento()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
begin
  -- escrita nascida dentro de uma função do servidor (SECURITY DEFINER)
  -- ou vinda do service_role: já foi validada lá dentro
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not (public.is_admin() or public.is_professional(new.professional_id)) then
      if new.status <> 'pendente' then
        raise exception 'Um agendamento novo começa como pendente';
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if public.is_admin() or public.is_professional(old.professional_id) then
      return new;
    end if;

    if old.client_id = public.meu_id() then
      if new.status <> 'cancelado' then
        raise exception 'Você só pode cancelar o seu agendamento';
      end if;
      if old.status not in ('pendente', 'confirmado') then
        raise exception 'Este agendamento não pode mais ser cancelado';
      end if;
      return new;
    end if;

    raise exception 'Sem permissão para alterar este agendamento';
  end if;

  return new;
end;
$$;

revoke execute on function public.valida_status_agendamento()
  from public, anon, authenticated;

drop trigger if exists on_valida_status on public.appointments;
create trigger on_valida_status
  before insert or update on public.appointments
  for each row execute function public.valida_status_agendamento();

-- A cliente também não muda data nem horário por fora: adiantar é
-- convite, e responder ao convite passa por responder_antecipacao().
-- (o grant de coluna já limitava a status e notes; isto é o cinto)
revoke update on public.appointments from authenticated;
grant update (status, notes) on public.appointments to authenticated;

-- =============================================================
-- >>> 023_whatsapp.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 023: o aviso sai do app e chega no WhatsApp
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 022).
--
-- Aviso dentro do app só alcança quem abriu o app — e a cliente
-- abre uma vez, marca, e some. Aqui o mesmo aviso ganha um segundo
-- caminho: uma fila de saída, com um adaptador de canal na ponta.
--
--   notificar()  ──▶  message_outbox  ──▶  canal do salão
--                                            manual    (wa.me, um toque)
--                                            evolution (chip próprio)
--                                            cloud     (API oficial)
--
-- Trocar de canal é trocar uma linha de configuração. A fila, as
-- tentativas, a janela de silêncio e o "não manda duas vezes" são
-- os mesmos nos três — e é isso que não se joga fora depois.
-- =============================================================

-- 1. Telefone em formato de máquina ---------------------------------------
-- A cliente digita "(13) 99871-0002", "13998710002", "+55 13 99871 0002".
-- O WhatsApp quer 5513998710002. Uma função só, para não ter três
-- jeitos diferentes espalhados pelo código.
create or replace function public.telefone_e164(bruto text)
returns text
language plpgsql
immutable
as $$
declare
  so_digitos text;
begin
  if bruto is null then
    return null;
  end if;

  so_digitos := regexp_replace(bruto, '\D', '', 'g');

  -- tira zeros de operadora na frente (0 13 9...)
  so_digitos := regexp_replace(so_digitos, '^0+', '');

  if length(so_digitos) < 10 then
    return null;              -- não dá para adivinhar o DDD
  end if;

  -- já veio com o país
  if length(so_digitos) in (12, 13) and left(so_digitos, 2) = '55' then
    return so_digitos;
  end if;

  -- DDD + número, com ou sem o nono dígito
  if length(so_digitos) in (10, 11) then
    return '55' || so_digitos;
  end if;

  return null;                -- formato que não reconhecemos
end;
$$;

-- 2. Qual canal cada salão usa -------------------------------------------
-- Segredo (token, api key) NÃO mora aqui: fica nos secrets da Edge
-- Function. Aqui fica só o que identifica a conta e o que a tela mostra.
create table if not exists public.whatsapp_channels (
  salon_id uuid primary key references public.salons (id) on delete cascade,
  canal text not null default 'manual'
    check (canal in ('manual', 'evolution', 'cloud')),
  -- evolution: nome da instância; cloud: o phone_number_id da Meta
  identificador text,
  -- só para mostrar na tela ("mandando de +55 13 99871-0002")
  numero_exibicao text,
  ativo boolean not null default true,
  -- fora desta faixa a mensagem espera o dia seguinte
  silencio_inicio time not null default '21:00',
  silencio_fim time not null default '08:00',
  -- freio de mão: teto de mensagens por dia, por salão
  teto_diario integer not null default 300 check (teto_diario between 0 and 5000),
  criado_em timestamptz not null default now()
);

alter table public.whatsapp_channels enable row level security;

drop policy if exists "admin ve o canal do salao" on public.whatsapp_channels;
create policy "admin ve o canal do salao"
  on public.whatsapp_channels for select
  to authenticated
  using (
    public.is_admin_do_salao(salon_id)
    or exists (
      select 1 from public.professionals p
      where p.salon_id = whatsapp_channels.salon_id
        and public.is_professional(p.id)
    )
  );

drop policy if exists "admin configura o canal" on public.whatsapp_channels;
create policy "admin configura o canal"
  on public.whatsapp_channels for all
  to authenticated
  using (public.is_admin_do_salao(salon_id))
  with check (public.is_admin_do_salao(salon_id));

-- todo salão nasce no canal manual: funciona sem configurar nada
insert into public.whatsapp_channels (salon_id)
select id from public.salons
on conflict (salon_id) do nothing;

create or replace function public.abre_canal_do_salao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.whatsapp_channels (salon_id)
  values (new.id)
  on conflict (salon_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.abre_canal_do_salao() from public, anon, authenticated;

drop trigger if exists ao_abrir_salao_canal on public.salons;
create trigger ao_abrir_salao_canal
  after insert on public.salons
  for each row execute function public.abre_canal_do_salao();

-- 3. Que tipo de aviso vale uma mensagem ---------------------------------
-- Nem todo aviso merece interromper alguém no WhatsApp. Tabela em vez
-- de constante no código: dá para ligar e desligar sem publicar nada.
create table if not exists public.whatsapp_regras (
  kind text primary key,
  envia boolean not null default true,
  -- 'utilidade' responde a uma ação da cliente; 'marketing' é você
  -- puxando conversa. Na API oficial isso muda a categoria e o preço.
  natureza text not null default 'utilidade'
    check (natureza in ('utilidade', 'marketing')),
  -- colado no fim da mensagem do WhatsApp, nunca no aviso do app.
  -- É aqui que mora o "responda 1" — a pergunta que abre a janela de
  -- 24h e faz a cliente responder sem abrir nada.
  sufixo text
);

alter table public.whatsapp_regras add column if not exists sufixo text;

insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('lembrete_agendamento', true,  'utilidade',
     'Responda 1 para confirmar ou 2 se precisar remarcar.'),
  ('agendamento_confirmado', true, 'utilidade', null),
  ('agendamento_cancelado', true, 'utilidade', null),
  -- estas duas ainda não têm resposta por WhatsApp: mandam para o app,
  -- onde o prazo da oferta é mostrado e contado
  ('vaga_disponivel',      true,  'utilidade',
     'Abra o app para pegar essa vaga — ela fica guardada por pouco tempo.'),
  ('agenda_adiantada',     true,  'utilidade',
     'Abra o app para responder ao convite.'),
  ('pos_atendimento',      false, 'utilidade', null),
  ('convite_retorno',      true,  'marketing',
     'Se não quiser mais receber, responda SAIR.'),
  ('indicacao_creditada',  false, 'utilidade', null),
  ('novo_agendamento',     false, 'utilidade', null),
  ('afiliado_novo',        false, 'utilidade', null),
  ('afiliado_cashback',    false, 'utilidade', null)
on conflict (kind) do nothing;

alter table public.whatsapp_regras enable row level security;

drop policy if exists "todo mundo le as regras" on public.whatsapp_regras;
create policy "todo mundo le as regras"
  on public.whatsapp_regras for select
  to authenticated using (true);

revoke insert, update, delete on public.whatsapp_regras from authenticated, anon;

-- 4. A fila -------------------------------------------------------------
create table if not exists public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons (id) on delete cascade,
  professional_id uuid references public.professionals (id) on delete set null,
  client_id uuid references public.profiles (id) on delete set null,
  notification_id uuid references public.notifications (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,

  telefone text not null,
  kind text not null,
  corpo text not null,

  canal text not null default 'manual',
  status text not null default 'na_fila'
    check (status in ('na_fila', 'enviando', 'enviado', 'entregue',
                      'lido', 'falhou', 'cancelado')),

  -- não sai antes disto (janela de silêncio, reagendamento de tentativa)
  liberado_em timestamptz not null default now(),
  tentativas integer not null default 0,
  erro text,
  provider_id text,
  enviado_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists outbox_fila_idx
  on public.message_outbox (status, liberado_em)
  where status in ('na_fila', 'enviando');

create index if not exists outbox_salao_idx
  on public.message_outbox (salon_id, criado_em desc);

-- Um lembrete por atendimento, custe o que custar. O reminder_sent_at
-- já cuida disso no caminho normal; este índice é o cinto de segurança
-- para quando alguém chamar a função duas vezes ao mesmo tempo.
create unique index if not exists outbox_um_lembrete_por_appt
  on public.message_outbox (appointment_id, kind)
  where appointment_id is not null
    and kind = 'lembrete_agendamento'
    and status <> 'cancelado';

alter table public.message_outbox enable row level security;

drop policy if exists "equipe ve a fila do salao" on public.message_outbox;
create policy "equipe ve a fila do salao"
  on public.message_outbox for select
  to authenticated
  using (
    public.is_admin_do_salao(salon_id)
    or (professional_id is not null and public.is_professional(professional_id))
  );

-- escrever é só pelas funções abaixo (e pelo service_role, na Edge Function)
revoke insert, update, delete on public.message_outbox from authenticated, anon;

-- 5. Enfileirar ----------------------------------------------------------
-- Decide se este aviso vira mensagem, para quem, por qual canal, e
-- quando pode sair. Chamada pelo notificar(); não é para uso direto.
-- o 025 acrescenta um parâmetro; derrubar as duas formas antes deixa
-- este arquivo re-executável em qualquer ordem
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid);
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text);

create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;                       -- sem telefone utilizável, fica só no app
  end if;

  -- de qual salão sai a mensagem
  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  -- teto diário do salão: freio de mão contra laço maluco
  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  -- Janela de silêncio: ninguém recebe lembrete de robô às 23h.
  -- No canal manual não vale — quem toca em enviar é gente, e segurar
  -- a mensagem só faria ela sumir da lista dela até as 8h.
  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    -- faixa dentro do mesmo dia
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    -- faixa que atravessa a meia-noite (o caso normal: 21h às 8h)
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  if regra.sufixo is not null then
    texto := texto || E'\n\n' || regra.sufixo;
  end if;

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, texto, canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid)
  from public, anon, authenticated;

-- 6. O notificar() passa a alimentar a fila ------------------------------
-- Mesma assinatura de sempre: nenhuma das 25 chamadas espalhadas pelo
-- sistema precisa mudar. O aviso continua caindo no app; agora também
-- entra na fila quando as regras deixam.
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
  carga_ok jsonb := coalesce(carga, '{}'::jsonb);
  prof uuid;
  appt uuid;
  mensagem text;
begin
  insert into public.notifications (user_id, kind, title, body, action_url, data, expires_at)
  values (destinatario, tipo, titulo, texto, url, carga_ok, vence_em)
  returning id into novo_id;

  -- o WhatsApp não tem título e corpo: junta os dois numa mensagem só
  mensagem := titulo;
  if texto is not null and btrim(texto) <> '' then
    mensagem := mensagem || E'\n\n' || texto;
  end if;

  begin
    prof := nullif(carga_ok ->> 'professional_id', '')::uuid;
  exception when others then prof := null;
  end;

  begin
    appt := nullif(carga_ok ->> 'appointment_id', '')::uuid;
  exception when others then appt := null;
  end;

  -- a fila nunca derruba o aviso: se algo der errado aqui, o app avisa
  -- do mesmo jeito e a mensagem simplesmente não sai
  begin
    perform public.enfileirar_whatsapp(novo_id, destinatario, tipo, mensagem, prof, appt);
  exception when others then
    null;
  end;

  return novo_id;
end;
$$;

revoke execute on function public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- 7. O que a profissional precisa enviar na mão --------------------------
-- No canal manual o app não manda: ele deixa pronto. Esta função
-- devolve a fila dela, com o link do WhatsApp já montado.
create or replace function public.fila_para_enviar(
  prof uuid default public.my_professional_id()
)
returns table (
  id uuid,
  cliente text,
  telefone text,
  kind text,
  corpo text,
  link text,
  criado_em timestamptz
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

  return query
  select o.id,
         coalesce(c.full_name, 'Cliente'),
         o.telefone,
         o.kind,
         o.corpo,
         'https://wa.me/' || o.telefone
           || '?text=' || public.url_encode_simples(o.corpo),
         o.criado_em
  from public.message_outbox o
  left join public.profiles c on c.id = o.client_id
  where o.professional_id = prof
    and o.canal = 'manual'
    and o.status = 'na_fila'
    and o.liberado_em <= now()
  order by o.criado_em;
end;
$$;

-- Codificação de URL suficiente para o corpo de um link do WhatsApp.
-- (o Postgres não traz uma pronta que sirva aqui)
create or replace function public.url_encode_simples(txt text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(
    case
      when letra ~ '[A-Za-z0-9._~-]' then letra
      -- "ç" são dois bytes em UTF-8, e cada byte quer o seu próprio %
      else regexp_replace(
             upper(encode(convert_to(letra, 'UTF8'), 'hex')),
             '(..)', '%\1', 'g')
    end,
    '' order by i
  ), '')
  from generate_series(1, coalesce(length(txt), 0)) as i,
       lateral (select substring(txt from i for 1) as letra) l;
$$;

revoke execute on function public.url_encode_simples(text) from public, anon;
grant execute on function public.url_encode_simples(text) to authenticated;

revoke execute on function public.fila_para_enviar(uuid) from public, anon;
grant execute on function public.fila_para_enviar(uuid) to authenticated;

-- Ela abriu o WhatsApp e mandou: some da lista.
create or replace function public.marcar_enviada_na_mao(mensagem_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m public.message_outbox%rowtype;
begin
  select * into m from public.message_outbox where id = mensagem_id;
  if not found then
    raise exception 'Mensagem não encontrada';
  end if;
  if not (public.is_admin_do_salao(m.salon_id)
          or (m.professional_id is not null and public.is_professional(m.professional_id))) then
    raise exception 'Sem permissão';
  end if;

  update public.message_outbox
  set status = 'enviado', enviado_em = now(), canal = 'manual'
  where id = mensagem_id and status = 'na_fila';
end;
$$;

revoke execute on function public.marcar_enviada_na_mao(uuid) from public, anon;
grant execute on function public.marcar_enviada_na_mao(uuid) to authenticated;

-- Não vou mandar essa: tira da fila sem mandar.
create or replace function public.descartar_da_fila(mensagem_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m public.message_outbox%rowtype;
begin
  select * into m from public.message_outbox where id = mensagem_id;
  if not found then
    raise exception 'Mensagem não encontrada';
  end if;
  if not (public.is_admin_do_salao(m.salon_id)
          or (m.professional_id is not null and public.is_professional(m.professional_id))) then
    raise exception 'Sem permissão';
  end if;

  update public.message_outbox
  set status = 'cancelado'
  where id = mensagem_id and status in ('na_fila', 'falhou');
end;
$$;

revoke execute on function public.descartar_da_fila(uuid) from public, anon;
grant execute on function public.descartar_da_fila(uuid) to authenticated;

-- Quantas estão esperando a mão dela (para o aviso na agenda)
create or replace function public.quantas_para_enviar(
  prof uuid default public.my_professional_id()
)
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  n integer;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    return 0;
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    return 0;
  end if;

  select count(*) into n
  from public.message_outbox o
  where o.professional_id = prof
    and o.canal = 'manual'
    and o.status = 'na_fila'
    and o.liberado_em <= now();

  return coalesce(n, 0);
end;
$$;

revoke execute on function public.quantas_para_enviar(uuid) from public, anon;
grant execute on function public.quantas_para_enviar(uuid) to authenticated;

-- =============================================================
-- >>> 024_resposta_whatsapp.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 024: a resposta da cliente mexe na agenda
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 023).
--
-- O lembrete termina em pergunta:
--
--     Amanhã tem horário marcado
--     Limpeza de pele com Ana Paula, 31/08 às 10:00.
--     Responda 1 para confirmar ou 2 se precisar remarcar.
--
-- Ela responde "1" e o agendamento confirma sozinho. Responde "2" e
-- cancela — e o gatilho da onda 1 já oferece a vaga para a fila de
-- espera, sem ninguém tocar em nada. Responde "sair" e não recebe
-- mais mensagem nenhuma.
--
-- Tudo pelo telefone, sem login: quem chega aqui é o webhook, e ele
-- entra como service_role. Nenhuma destas funções é exposta à
-- cliente nem ao app.
-- =============================================================

-- 1. Registro do que entrou ----------------------------------------------
-- Guardar a mensagem crua vale ouro no dia em que alguém disser
-- "eu cancelei e vocês cobraram mesmo assim".
create table if not exists public.whatsapp_inbox (
  id uuid primary key default gen_random_uuid(),
  telefone text not null,
  texto text,
  provider_id text unique,
  client_id uuid references public.profiles (id) on delete set null,
  -- sair | confirmado | cancelado | nada | sem_cadastro | sem_horario
  -- | fora_de_contexto
  acao text,
  appointment_id uuid references public.appointments (id) on delete set null,
  recebido_em timestamptz not null default now()
);

create index if not exists inbox_telefone_idx
  on public.whatsapp_inbox (telefone, recebido_em desc);

alter table public.whatsapp_inbox enable row level security;

drop policy if exists "equipe le as respostas" on public.whatsapp_inbox;
create policy "equipe le as respostas"
  on public.whatsapp_inbox for select
  to authenticated
  using (client_id is not null and public.atende_esta_cliente(client_id));

revoke insert, update, delete on public.whatsapp_inbox from authenticated, anon;

-- 2. De telefone para pessoa ---------------------------------------------
create or replace function public.cliente_pelo_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  where public.telefone_e164(p.phone) = public.telefone_e164(tel)
  order by p.created_at
  limit 1;
$$;

revoke execute on function public.cliente_pelo_telefone(text)
  from public, anon, authenticated;

-- 3. O próximo horário dela ----------------------------------------------
-- "1" e "2" se referem sempre ao atendimento mais próximo que ainda
-- não aconteceu. É o que ela tem na cabeça quando responde.
create or replace function public.proximo_agendamento_da_cliente(cliente uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select a.id
  from public.appointments a
  where a.client_id = cliente
    and a.status in ('pendente', 'confirmado')
    and (a.date + a.start_time) > public.agora_local()
  order by a.date, a.start_time
  limit 1;
$$;

revoke execute on function public.proximo_agendamento_da_cliente(uuid)
  from public, anon, authenticated;

-- 4. Sobre o que ela está respondendo ------------------------------------
-- "1" sozinho não quer dizer nada: quer dizer alguma coisa em relação à
-- última mensagem que saiu daqui. Sem isso, um "1" respondendo ao
-- convite de retorno confirmaria um atendimento que ela nem lembra.
create or replace function public.ultimo_assunto_enviado(tel text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select o.kind
  from public.message_outbox o
  where o.telefone = public.telefone_e164(tel)
    and o.status in ('enviado', 'entregue', 'lido')
    and o.enviado_em > now() - interval '48 hours'
  order by o.enviado_em desc
  limit 1;
$$;

revoke execute on function public.ultimo_assunto_enviado(text)
  from public, anon, authenticated;

-- 5. O que a resposta quis dizer -----------------------------------------
create or replace function public.interpretar_resposta(texto text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  if texto is null then
    return 'nada';
  end if;

  -- tira acento, pontuação e espaço: "Sim!" e "sim" são a mesma coisa
  t := lower(btrim(texto));
  t := translate(t, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  t := regexp_replace(t, '[^a-z0-9 ]', '', 'g');
  t := btrim(t);

  if t in ('sair', 'parar', 'stop', 'cancelar avisos', 'nao quero mais',
           'descadastrar', 'remover') then
    return 'sair';
  end if;

  if t in ('1', 'sim', 's', 'confirmo', 'confirmado', 'ok', 'certo',
           'isso', 'confirmar', 'positivo', 'estarei la', 'vou') then
    return 'confirma';
  end if;

  if t in ('2', 'nao', 'n', 'remarcar', 'cancelar', 'desmarcar',
           'nao vou', 'nao posso', 'negativo') then
    return 'cancela';
  end if;

  return 'nada';
end;
$$;

revoke execute on function public.interpretar_resposta(text)
  from public, anon, authenticated;

-- 6. A porta de entrada --------------------------------------------------
-- Chamada pela Edge Function do webhook, como service_role. Devolve o
-- que fazer com a resposta — a Edge Function usa isso para escrever de
-- volta no WhatsApp.
-- o 028 troca a assinatura; derrubar as duas antes deixa re-executável
drop function if exists public.receber_resposta_whatsapp(text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- o mesmo provider_id chegando duas vezes não age duas vezes
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);
  acao := public.interpretar_resposta(texto);

  -- ------------------------------------------------------------------
  -- Sair: vale mesmo para quem não tem conta no app
  -- ------------------------------------------------------------------
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox
      set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'sair');

    return jsonb_build_object(
      'acao', 'sair',
      'responder', 'Pronto, não mando mais lembretes por aqui. ' ||
                   'Se mudar de ideia, é só ligar de novo no app.'
    );
  end if;

  -- ------------------------------------------------------------------
  -- Daqui para baixo precisa saber de quem é o telefone
  -- ------------------------------------------------------------------
  if cliente is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, acao)
    values (e164, texto, id_provedor, 'sem_cadastro');
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'nada');
    return jsonb_build_object('acao', 'nada');
  end if;

  -- 1 e 2 só mexem na agenda quando a conversa é sobre um horário.
  -- Respondeu 1 para o convite de retorno? Não confirmamos nada por
  -- conta própria — fica registrado para a profissional ver.
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto');
    return jsonb_build_object(
      'acao', 'fora_de_contexto',
      'responder', 'Recebi! Para marcar ou mudar um horário, é só abrir o app.'
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'sem_horario');
    return jsonb_build_object(
      'acao', 'sem_horario',
      'responder', 'Não encontrei nenhum horário marcado no seu nome. ' ||
                   'Se precisar, é só marcar pelo app.'
    );
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;

  if acao = 'confirma' then
    update public.appointments
    set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || to_char(appt.date, 'DD/MM') ||
        ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object(
      'acao', 'confirmado',
      'appointment_id', appt_id,
      'responder', 'Confirmado! Te espero dia ' || to_char(appt.date, 'DD/MM') ||
                   ' às ' || to_char(appt.start_time, 'HH24:MI') || '.'
    );

  else
    -- cancela: o gatilho da lista de espera cuida de oferecer a vaga
    update public.appointments
    set status = 'cancelado'
    where id = appt_id;

    resposta := jsonb_build_object(
      'acao', 'cancelado',
      'appointment_id', appt_id,
      'responder', 'Tudo bem, cancelei o seu horário de ' ||
                   to_char(appt.date, 'DD/MM') || ' às ' ||
                   to_char(appt.start_time, 'HH24:MI') ||
                   '. Quando quiser remarcar, é só abrir o app.'
    );

    -- a profissional precisa saber que abriu um buraco na agenda dela
    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || to_char(appt.date, 'DD/MM') ||
          ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id);

  return resposta;
end;
$$;

revoke execute on function public.receber_resposta_whatsapp(text, text, text)
  from public, anon, authenticated;

-- Por onde responder a ela: o mesmo canal que entregou a última
-- mensagem. Ela respondeu, então a janela de 24h está aberta e a
-- resposta sai sem template e sem custo.
create or replace function public.canal_do_telefone(tel text)
returns table (canal text, identificador text)
language sql
stable
security definer set search_path = public
as $$
  select c.canal, c.identificador
  from public.message_outbox o
  join public.whatsapp_channels c on c.salon_id = o.salon_id
  where o.telefone = public.telefone_e164(tel)
    and o.status in ('enviado', 'entregue', 'lido')
  order by o.enviado_em desc nulls last
  limit 1;
$$;

revoke execute on function public.canal_do_telefone(text)
  from public, anon, authenticated;

-- 7. Status de entrega ---------------------------------------------------
-- O provedor avisa que entregou, que a cliente leu, ou que falhou.
create or replace function public.atualizar_status_envio(
  id_provedor text,
  novo_status text,
  detalhe text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if novo_status not in ('enviado', 'entregue', 'lido', 'falhou') then
    return;
  end if;

  update public.message_outbox
  set status = novo_status,
      erro = case when novo_status = 'falhou' then detalhe else erro end
  where provider_id = id_provedor
    -- nunca volta atrás: "entregue" que chega depois de "lido" é ruído
    and case novo_status
          when 'enviado'  then status in ('enviando')
          when 'entregue' then status in ('enviando', 'enviado')
          when 'lido'     then status in ('enviando', 'enviado', 'entregue')
          when 'falhou'   then status in ('enviando', 'enviado')
        end;
end;
$$;

revoke execute on function public.atualizar_status_envio(text, text, text)
  from public, anon, authenticated;

-- 8. O que a Edge Function chama para pegar trabalho ---------------------
-- Marca como 'enviando' e devolve, numa tacada só, para duas chamadas
-- ao mesmo tempo não pegarem a mesma mensagem.
-- o 025 muda o formato de retorno desta função; derrubar antes deixa
-- o arquivo re-executável mesmo depois dele ter passado
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  corpo text
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.corpo
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone, m.corpo
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- Deu erro no envio: volta para a fila com espera crescente, ou desiste.
create or replace function public.devolver_para_fila(
  mensagem_id uuid,
  motivo text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t integer;
begin
  select tentativas into t from public.message_outbox where id = mensagem_id;
  if not found then
    return;
  end if;

  if t >= 4 then
    update public.message_outbox
    set status = 'falhou', erro = motivo
    where id = mensagem_id;
  else
    -- 2, 8, 32 minutos: dá tempo de a instância voltar sozinha
    update public.message_outbox
    set status = 'na_fila',
        erro = motivo,
        liberado_em = now() + make_interval(mins => power(4, t)::integer * 2)
    where id = mensagem_id;
  end if;
end;
$$;

revoke execute on function public.devolver_para_fila(uuid, text)
  from public, anon, authenticated;

-- Erro que não melhora tentando de novo (número errado, fora da janela,
-- conta mal configurada): desiste na hora em vez de gastar 4 tentativas.
create or replace function public.falhar_de_vez(
  mensagem_id uuid,
  motivo text
)
returns void
language sql
security definer set search_path = public
as $$
  update public.message_outbox
  set status = 'falhou', erro = motivo, tentativas = 4
  where id = mensagem_id;
$$;

revoke execute on function public.falhar_de_vez(uuid, text)
  from public, anon, authenticated;

-- Enviou: guarda o id do provedor para casar com o status depois.
create or replace function public.confirmar_envio(
  mensagem_id uuid,
  id_provedor text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.message_outbox
  set status = 'enviado',
      enviado_em = now(),
      provider_id = coalesce(id_provedor, provider_id),
      erro = null
  where id = mensagem_id;
end;
$$;

revoke execute on function public.confirmar_envio(uuid, text)
  from public, anon, authenticated;

-- =============================================================
-- OPCIONAL — deixar a fila andando sozinha
--
-- Sem isto, a fila só é drenada quando alguém chama a Edge Function.
-- Com isto, ela anda de minuto em minuto, e o lembrete de véspera sai
-- às 19h sem ninguém abrir nada.
--
-- Ative as extensões em Database → Extensions (pg_cron e pg_net) e
-- rode o bloco abaixo trocando as duas linhas marcadas.
-- =============================================================

-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'agenda-mel-envia-whatsapp',
--   '* * * * *',
--   $cron$
--     select net.http_post(
--       url     := 'https://SEU-PROJETO.supabase.co/functions/v1/enviar-whatsapp',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer SUA_SERVICE_ROLE_KEY'
--       ),
--       body    := '{}'::jsonb
--     );
--   $cron$
-- );
--
-- -- e os lembretes de véspera, de hora em hora:
-- select cron.schedule(
--   'agenda-mel-lembretes',
--   '0 * * * *',
--   $cron$ select public.enviar_lembretes(); $cron$
-- );
--
-- -- para conferir:   select * from cron.job;
-- -- para desligar:   select cron.unschedule('agenda-mel-envia-whatsapp');

-- =============================================================
-- >>> 025_botoes.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 025: botão em vez de digitar 1
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 024).
--
-- "Responda 1 para confirmar" funciona, mas pedir para a cliente
-- digitar é atrito. O WhatsApp tem botão de resposta — até três.
--
-- Só que botão vindo de cliente não-oficial (Evolution/Baileys) é
-- instável: em alguns aparelhos renderiza, em outros chega como
-- texto puro. Então o desenho aqui é: tenta o botão, e se o envio
-- falhar, manda o texto de sempre. O "1" digitado continua valendo
-- nos dois casos, e quem toca no botão devolve exatamente o mesmo
-- "1" — o resto do sistema nem fica sabendo a diferença.
-- =============================================================

-- 1. O título separado do corpo -----------------------------------------
-- O texto sai como um bloco só ("título\n\ncorpo"), mas o botão quer
-- os dois separados. Guardar separado é mais simples do que tentar
-- fatiar de volta na hora do envio.
alter table public.message_outbox
  add column if not exists titulo text;

-- 2. Que botões cada tipo de aviso leva ----------------------------------
alter table public.whatsapp_regras
  add column if not exists botoes jsonb;

update public.whatsapp_regras
set botoes = '[
      {"type": "reply", "displayText": "Confirmar",        "id": "1"},
      {"type": "reply", "displayText": "Preciso remarcar", "id": "2"}
    ]'::jsonb
where kind = 'lembrete_agendamento' and botoes is null;

-- 3. O salão pode desligar os botões -------------------------------------
alter table public.whatsapp_channels
  add column if not exists usa_botoes boolean not null default true;

-- 4. Enfileirar guardando o título ---------------------------------------
-- Ganhou um parâmetro, então a versão de seis argumentos precisa sair
-- de cena — senão ficam as duas e o Postgres não sabe qual chamar.
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid);

create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null,
  cabecalho text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;
  end if;

  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  -- Com botão o sufixo vira redundante: o "Responda 1" está escrito
  -- no próprio botão. Sem botão, o sufixo é o que ensina a responder.
  if regra.sufixo is not null
     and not (canal.usa_botoes and regra.botoes is not null and canal.canal <> 'manual') then
    texto := texto || E'\n\n' || regra.sufixo;
  end if;

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, titulo, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, cabecalho, texto, canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function
  public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 5. O notificar() passa o título ----------------------------------------
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
  carga_ok jsonb := coalesce(carga, '{}'::jsonb);
  prof uuid;
  appt uuid;
  corpo text;
begin
  insert into public.notifications (user_id, kind, title, body, action_url, data, expires_at)
  values (destinatario, tipo, titulo, texto, url, carga_ok, vence_em)
  returning id into novo_id;

  corpo := coalesce(nullif(btrim(coalesce(texto, '')), ''), titulo);

  begin
    prof := nullif(carga_ok ->> 'professional_id', '')::uuid;
  exception when others then prof := null;
  end;

  begin
    appt := nullif(carga_ok ->> 'appointment_id', '')::uuid;
  exception when others then appt := null;
  end;

  begin
    perform public.enfileirar_whatsapp(novo_id, destinatario, tipo, corpo, prof, appt, titulo);
  exception when others then
    null;
  end;

  return novo_id;
end;
$$;

revoke execute on function
  public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- 6. A fila entrega título e botões para quem envia ----------------------
-- O Postgres não deixa trocar o formato de retorno com "create or
-- replace": tem de derrubar antes.
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.titulo, o.corpo, o.kind
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone,
         m.titulo, m.corpo,
         case when c.usa_botoes then r.botoes else null end
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- 7. A fila manual continua com o texto inteiro --------------------------
-- No canal manual não existe botão: a profissional copia e cola.
-- Ali o corpo precisa carregar título e sufixo, como antes.
create or replace function public.fila_para_enviar(
  prof uuid default public.my_professional_id()
)
returns table (
  id uuid,
  cliente text,
  telefone text,
  kind text,
  corpo text,
  link text,
  criado_em timestamptz
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

  return query
  select o.id,
         coalesce(c.full_name, 'Cliente'),
         o.telefone,
         o.kind,
         case
           when o.titulo is not null and btrim(o.titulo) <> ''
             then o.titulo || E'\n\n' || o.corpo
           else o.corpo
         end,
         'https://wa.me/' || o.telefone || '?text=' ||
           public.url_encode_simples(
             case
               when o.titulo is not null and btrim(o.titulo) <> ''
                 then o.titulo || E'\n\n' || o.corpo
               else o.corpo
             end),
         o.criado_em
  from public.message_outbox o
  left join public.profiles c on c.id = o.client_id
  where o.professional_id = prof
    and o.canal = 'manual'
    and o.status = 'na_fila'
    and o.liberado_em <= now()
  order by o.criado_em;
end;
$$;

revoke execute on function public.fila_para_enviar(uuid) from public, anon;
grant execute on function public.fila_para_enviar(uuid) to authenticated;

-- =============================================================
-- >>> 026_botao_so_na_oficial.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 026: botão só na API oficial
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 025).
--
-- O 025 mandou botão pela Evolution. Resultado no aparelho:
--
--     "Não foi possível carregar a mensagem.
--      Use seu celular para acessá-la."
--
-- E no celular também não aparecia. A mensagem se perdeu.
--
-- O que aconteceu: o WhatsApp restringiu mensagem interativa vinda
-- de cliente não-oficial. A Evolution monta o pacote, o servidor do
-- WhatsApp aceita e entrega — e o aplicativo de quem recebe não sabe
-- desenhar aquilo. A API devolve 200, o banco marca "enviado", e a
-- cliente não vê nada. O plano B do 025 não salva porque ele só age
-- quando a API RECUSA; aqui ela aprovou.
--
-- Não dá para detectar isso do lado de cá. Então botão passa a sair
-- só no canal 'cloud', a API oficial da Meta, onde mensagem
-- interativa é de primeira classe e sempre renderiza.
--
-- No canal 'evolution' volta o texto com "Responda 1 para confirmar
-- ou 2 se precisar remarcar" — que é feio, e funciona.
--
-- Não é porta trancada: usa_botoes continua ligável na Evolution para
-- quem quiser tentar. Duas coisas mudam a chance de renderizar, e as
-- duas dependem do número, não do código:
--
--   • o chip ser conta WhatsApp BUSINESS (o app verde escuro, grátis)
--     em vez de WhatsApp comum
--   • a cliente ter escrito para você nas últimas 24h
--
-- Se for tentar: ligue, mande UMA mensagem, confira no aparelho, e
-- desligue se não aparecer. Cada tentativa que não renderiza é uma
-- mensagem que a cliente nunca vê.
-- =============================================================

-- 1. Desliga onde já estava ligado ---------------------------------------
update public.whatsapp_channels set usa_botoes = false where usa_botoes;

alter table public.whatsapp_channels alter column usa_botoes set default false;

comment on column public.whatsapp_channels.usa_botoes is
  'Botão de resposta. Na cloud funciona sempre. Na Evolution o WhatsApp '
  'costuma entregar sem o aparelho conseguir desenhar, e a mensagem se '
  'perde sem erro — por isso nasce desligado. Vale tentar de novo se o '
  'número virar conta WhatsApp Business.';

-- 2. Uma regra só, em um lugar só ----------------------------------------
-- Duas funções precisavam decidir a mesma coisa (mandar botão?) e
-- precisam decidir igual: se divergirem, o sufixo "responda 1" some
-- de uma mensagem que vai sair sem botão nenhum.
--
-- A porta continua destrancada: quem quiser experimentar botão na
-- Evolution é só ligar usa_botoes de novo. O padrão é desligado
-- porque é o que comprovadamente chega.
create or replace function public.canal_manda_botao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select c.usa_botoes and c.canal in ('cloud', 'evolution')
     from public.whatsapp_channels c
     where c.salon_id = salao),
    false);
$$;

revoke execute on function public.canal_manda_botao(uuid)
  from public, anon, authenticated;

-- 3. O sufixo volta quando não há botão ----------------------------------
create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null,
  cabecalho text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;
  end if;

  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  -- só cai fora quando o botão realmente vai junto e vai renderizar
  if regra.sufixo is not null
     and not (regra.botoes is not null and public.canal_manda_botao(salao)) then
    texto := texto || E'\n\n' || regra.sufixo;
  end if;

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, titulo, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, cabecalho, texto, canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function
  public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 4. A fila só entrega botão para o canal que sabe usar ------------------
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.titulo, o.corpo, o.kind
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone,
         m.titulo, m.corpo,
         case when public.canal_manda_botao(m.salon_id) then r.botoes else null end
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- 5. Reabre o que se perdeu ----------------------------------------------
-- Mensagem marcada "enviado" que na verdade não renderizou volta para a
-- fila, agora como texto. Só as de hoje, e só as que levaram botão.
update public.message_outbox o
set status = 'na_fila', provider_id = null, tentativas = 0
from public.whatsapp_regras r
where r.kind = o.kind
  and r.botoes is not null
  and o.canal = 'evolution'
  and o.status in ('enviado', 'entregue')
  and o.enviado_em > now() - interval '6 hours';

-- =============================================================
-- >>> 027_estilo_do_botao.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 027: o botão que renderiza
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 026).
--
-- O botão "nativo" (nativeFlowMessage) não desenha em cliente
-- não-oficial. Mas o WhatsApp tem outro jeito de oferecer opções
-- tocáveis que é recurso de CONSUMIDOR, e por isso renderiza em
-- qualquer aparelho: a ENQUETE.
--
--     Amanhã tem horário marcado
--     Design de sobrancelhas com Ana Paula dia 02/09 às 10:30.
--
--      ○ Confirmar
--      ○ Preciso remarcar
--
-- A cliente toca, o voto volta descriptografado (a Evolution 2.3.7
-- faz isso, linhas ~1206-1303 do serviço Baileys), e o webhook
-- traduz para "1" ou "2" — o resto do sistema nem nota.
--
-- Cada salão escolhe o estilo. O padrão é o que comprovadamente
-- aparece.
-- =============================================================

alter table public.whatsapp_channels
  add column if not exists estilo_botao text not null default 'enquete'
    check (estilo_botao in ('enquete', 'lista', 'nativo'));

comment on column public.whatsapp_channels.estilo_botao is
  'enquete = poll do WhatsApp (renderiza em todo aparelho — testado); '
  'lista = listMessage (a Evolution 2.3.7 RECUSA com "this.isZero is '
  'not a function"; cai para texto); '
  'nativo = nativeFlow buttons (a API aceita, o aparelho não desenha, '
  'a mensagem se perde). Na cloud qualquer estilo vira botão de verdade.';

-- com a enquete funcionando, botão volta a nascer ligado
alter table public.whatsapp_channels alter column usa_botoes set default true;
update public.whatsapp_channels set usa_botoes = true where not usa_botoes;

-- A regra: manda opção tocável quando o salão quer E o canal é
-- automático. Qual estilo, quem decide é o adaptador, lendo a coluna.
create or replace function public.canal_manda_botao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select c.usa_botoes and c.canal in ('cloud', 'evolution')
     from public.whatsapp_channels c
     where c.salon_id = salao),
    false);
$$;

revoke execute on function public.canal_manda_botao(uuid)
  from public, anon, authenticated;

-- A fila entrega o estilo junto com os botões
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb,
  estilo_botao text
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.titulo, o.corpo, o.kind
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone,
         m.titulo, m.corpo,
         case when public.canal_manda_botao(m.salon_id) then r.botoes else null end,
         c.estilo_botao
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- O texto da opção também é entendido, caso chegue como texto
-- (alguém digita "Confirmar" em vez de tocar)
create or replace function public.interpretar_resposta(texto text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  if texto is null then
    return 'nada';
  end if;

  t := lower(btrim(texto));
  t := translate(t, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  t := regexp_replace(t, '[^a-z0-9 ]', '', 'g');
  t := btrim(t);

  if t in ('sair', 'parar', 'stop', 'cancelar avisos', 'nao quero mais',
           'descadastrar', 'remover') then
    return 'sair';
  end if;

  if t in ('1', 'sim', 's', 'confirmo', 'confirmado', 'ok', 'certo',
           'isso', 'confirmar', 'positivo', 'estarei la', 'vou') then
    return 'confirma';
  end if;

  if t in ('2', 'nao', 'n', 'remarcar', 'cancelar', 'desmarcar',
           'nao vou', 'nao posso', 'negativo', 'preciso remarcar') then
    return 'cancela';
  end if;

  return 'nada';
end;
$$;

revoke execute on function public.interpretar_resposta(text)
  from public, anon, authenticated;

-- Reabre as que saíram como botão nativo e não renderizaram
update public.message_outbox o
set status = 'na_fila', provider_id = null, tentativas = 0
from public.whatsapp_regras r
where r.kind = o.kind
  and r.botoes is not null
  and o.canal = 'evolution'
  and o.status in ('enviado', 'entregue')
  and o.enviado_em > now() - interval '6 hours';

-- =============================================================
-- >>> 028_primeiro_voto_vale.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 028: texto por padrão, e o primeiro voto vale
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 027).
--
-- Duas decisões de produto, depois do teste no aparelho:
--
-- 1. ENQUETE NÃO É CONFIRMAÇÃO. Ela renderiza em todo lugar, mas na
--    tela da cliente diz "pesquisa", com "1 voto" e "ver votos" em
--    volta. Sobre um horário marcado, não faz sentido. Então o padrão
--    na Evolution volta a ser TEXTO com "Responda 1 para confirmar ou
--    2 se precisar remarcar" — feio, honesto, e chega. A enquete fica
--    disponível como estilo para outro uso (pesquisa com clientes).
--    Botão de verdade é coisa da API oficial (canal cloud).
--
-- 2. O PRIMEIRO VOTO VALE. Onde a enquete for usada, o WhatsApp deixa
--    trocar o voto e cada troca chega como evento novo. Sem trava,
--    "Confirmar" e depois "Preciso remarcar" confirmava e cancelava o
--    mesmo horário em sequência. Agora o primeiro age; os seguintes
--    recebem "já registrado, fale com a profissional".
-- =============================================================

-- 1. Estilo 'texto' como padrão; 'lista' sai (a 2.3.7 recusa) ------------
alter table public.whatsapp_channels drop constraint if exists whatsapp_channels_estilo_botao_check;
update public.whatsapp_channels set estilo_botao = 'texto' where estilo_botao in ('enquete', 'lista');
alter table public.whatsapp_channels alter column estilo_botao set default 'texto';
alter table public.whatsapp_channels
  add constraint whatsapp_channels_estilo_botao_check
  check (estilo_botao in ('texto', 'enquete', 'nativo'));

comment on column public.whatsapp_channels.estilo_botao is
  'texto = "Responda 1 ou 2" (padrão na Evolution; funciona sempre); '
  'enquete = poll do WhatsApp (renderiza, mas parece pesquisa — para '
  'outro uso); nativo = botão interativo (só a Cloud API desenha). '
  'No canal cloud, qualquer estilo vira botão de verdade.';

-- botão só quando vai renderizar como botão, ou quando o salão pediu
-- a enquete de propósito
create or replace function public.canal_manda_botao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select c.usa_botoes
            and (c.canal = 'cloud'
                 or (c.canal = 'evolution' and c.estilo_botao = 'enquete'))
     from public.whatsapp_channels c
     where c.salon_id = salao),
    false);
$$;

revoke execute on function public.canal_manda_botao(uuid)
  from public, anon, authenticated;

-- 2. O primeiro voto vale --------------------------------------------------
-- (o 029 recria enfileirar_whatsapp; nada a derrubar aqui)

alter table public.whatsapp_inbox
  add column if not exists enquete_id text;

create index if not exists inbox_enquete_idx
  on public.whatsapp_inbox (enquete_id)
  where enquete_id is not null;

drop function if exists public.receber_resposta_whatsapp(text, text, text);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
  ja_votou record;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- o mesmo evento chegando duas vezes não age duas vezes
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);
  acao := public.interpretar_resposta(texto);

  -- ------------------------------------------------------------------
  -- Voto trocado na mesma enquete: o primeiro já valeu
  -- ------------------------------------------------------------------
  if id_enquete is not null then
    select i.acao, i.appointment_id into ja_votou
    from public.whatsapp_inbox i
    where i.enquete_id = id_enquete
      and i.acao in ('confirmado', 'cancelado')
    order by i.recebido_em
    limit 1;

    if found then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
      values (e164, texto, id_provedor, cliente, 'voto_repetido', ja_votou.appointment_id, id_enquete);

      select * into prof
      from public.professionals p
      join public.appointments a on a.professional_id = p.id
      where a.id = ja_votou.appointment_id;

      return jsonb_build_object(
        'acao', 'voto_repetido',
        'responder',
          'Sua resposta já foi registrada'
          || case when ja_votou.acao = 'confirmado' then ' (horário confirmado)' else ' (horário cancelado)' end
          || '. Para mudar, é só falar aqui com a ' || coalesce(prof.name, 'profissional') || '.'
      );
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- Sair: vale mesmo para quem não tem conta no app
  -- ------------------------------------------------------------------
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox
      set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sair', id_enquete);

    return jsonb_build_object(
      'acao', 'sair',
      'responder', 'Pronto, não mando mais lembretes por aqui. ' ||
                   'Se mudar de ideia, é só ligar de novo no app.'
    );
  end if;

  if cliente is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, acao, enquete_id)
    values (e164, texto, id_provedor, 'sem_cadastro', id_enquete);
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'nada', id_enquete);
    return jsonb_build_object('acao', 'nada');
  end if;

  -- 1 e 2 só mexem na agenda quando a conversa é sobre um horário
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto', id_enquete);
    return jsonb_build_object(
      'acao', 'fora_de_contexto',
      'responder', 'Recebi! Para marcar ou mudar um horário, é só abrir o app.'
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete);
    return jsonb_build_object(
      'acao', 'sem_horario',
      'responder', 'Não encontrei nenhum horário marcado no seu nome. ' ||
                   'Se precisar, é só marcar pelo app.'
    );
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;

  if acao = 'confirma' then
    update public.appointments
    set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || to_char(appt.date, 'DD/MM') ||
        ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object(
      'acao', 'confirmado',
      'appointment_id', appt_id,
      'responder', 'Confirmado! Te espero dia ' || to_char(appt.date, 'DD/MM') ||
                   ' às ' || to_char(appt.start_time, 'HH24:MI') || '.'
    );

  else
    update public.appointments
    set status = 'cancelado'
    where id = appt_id;

    resposta := jsonb_build_object(
      'acao', 'cancelado',
      'appointment_id', appt_id,
      'responder', 'Tudo bem, cancelei o seu horário de ' ||
                   to_char(appt.date, 'DD/MM') || ' às ' ||
                   to_char(appt.start_time, 'HH24:MI') ||
                   '. Quando quiser remarcar, é só abrir o app.'
    );

    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || to_char(appt.date, 'DD/MM') ||
          ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id, id_enquete);

  return resposta;
end;
$$;

revoke execute on function public.receber_resposta_whatsapp(text, text, text, text)
  from public, anon, authenticated;

-- =============================================================
-- >>> 029_texto_bonito.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 029: a mensagem do WhatsApp com cara de mensagem
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 028).
--
-- O aviso dentro do app é seco de propósito — sem emoji, tipografia
-- do sistema. No WhatsApp é o contrário: mensagem sem emoji parece
-- robô. Então o texto do WhatsApp deixa de ser "título + corpo" do
-- app e passa a ser montado aqui, por tipo, com *negrito*, emoji e
-- o link da agenda da profissional.
--
-- O link só entra quando o salão tem endereço público gravado
-- (salons.app_url). Sem ele, a mensagem sai sem a linha do link —
-- melhor que mandar localhost para a cliente.
-- =============================================================

-- 1. O endereço público do app, por salão -------------------------------
alter table public.salons
  add column if not exists app_url text
    check (app_url is null or app_url ~ '^https?://');

comment on column public.salons.app_url is
  'Endereço público do app (ex.: https://agendamel.vercel.app). '
  'É o que vai nos links das mensagens de WhatsApp. Sem barra no fim.';

-- a dona do salão grava isso pela tela de horários
drop policy if exists "admin edita o salao" on public.salons;
create policy "admin edita o salao"
  on public.salons for update
  to authenticated
  using (public.is_admin_do_salao(id))
  with check (public.is_admin_do_salao(id));

grant update (app_url, name, brand_color) on public.salons to authenticated;

-- 2. O texto, por tipo ---------------------------------------------------
create or replace function public.montar_texto_whatsapp(
  tipo text,
  titulo text,
  corpo text,
  appt uuid,
  prof uuid,
  cliente uuid
)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  -- variáveis escalares, não RECORD: no plpgsql, ler um campo de um
  -- record que nunca foi atribuído levanta erro, e como o notificar()
  -- engole exceções da fila, a mensagem sumiria em silêncio. Foi o que
  -- aconteceu com "chamar de volta", que não tem agendamento.
  d_data date;
  d_hora time;
  servico text;
  prof_nome text;
  prof_slug text;
  base text;
  link text;
  link_app text;
  nome_cliente text;
  quando text;
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name), ap.professional_id
      into d_data, d_hora, servico, prof
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    where ap.id = appt;
  end if;

  if prof is not null then
    select pr.name, pr.slug, rtrim(sl.app_url, '/')
      into prof_nome, prof_slug, base
    from public.professionals pr
    join public.salons sl on sl.id = pr.salon_id
    where pr.id = prof;
  end if;

  if cliente is not null then
    select nullif(split_part(coalesce(full_name, ''), ' ', 1), '')
      into nome_cliente
    from public.profiles where id = cliente;
  end if;

  if base is not null then
    link_app := base || '/';
    if prof_slug is not null then
      link := base || '/p/' || prof_slug;
    end if;
  end if;

  if d_data is not null then
    quando := to_char(d_data, 'DD/MM') || ' às ' || to_char(d_hora, 'HH24:MI');
  end if;

  case tipo

  when 'lembrete_agendamento' then
    return
      '📅 *Amanhã tem horário marcado*' || E'\n\n'
      || 'Oi' || coalesce(', ' || nome_cliente, '') || '! Só passando pra lembrar:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '') || E'\n\n'
      || 'Responda *1* pra confirmar, ou *2* se precisar remarcar.'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link, '');

  when 'agendamento_confirmado' then
    return
      '✅ *Horário confirmado*' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '') || E'\n\n'
      || 'Te esperamos! 💛'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'agendamento_cancelado' then
    return
      '❌ *Horário cancelado*' || E'\n\n'
      || coalesce(servico, 'Seu atendimento') || coalesce(' de ' || quando, '')
      || ' foi cancelado.' || E'\n\n'
      || 'Quando quiser remarcar, é só escolher um horário novo'
      || coalesce(': ' || link, ' pelo app.');

  when 'convite_retorno' then
    return
      '💛 *Oi' || coalesce(', ' || nome_cliente, '') || '!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), 'Faz um tempo que você não aparece — a agenda está aberta.')
      || E'\n\n'
      || '📅 Escolha um horário' || coalesce(': ' || link, ' pelo app.') || E'\n\n'
      || '_Se não quiser mais receber, responda SAIR._';

  when 'pos_atendimento' then
    return
      '💆 *Obrigada pela visita' || coalesce(', ' || nome_cliente, '') || '!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), 'Esperamos você de novo.')
      -- o corpo do 019 já pergunta "quer já deixar marcado?"; aqui só o link
      || coalesce(E'\n\n' || '📅 ' || link, '');

  when 'vaga_disponivel' then
    return
      '⏰ *Abriu uma vaga!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), '') || E'\n\n'
      || '⚡ Ela fica guardada pra você por pouco tempo — abra o app pra pegar'
      || coalesce(': ' || link_app, '.');

  when 'agenda_adiantada' then
    return
      '⏰ *Dá pra vir mais cedo?*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), '') || E'\n\n'
      || '👉 Responda pelo app' || coalesce(': ' || link_app, '.');

  else
    -- tipo sem tratamento próprio: título em negrito e o corpo, sem invenção
    return '*' || coalesce(titulo, '') || '*'
      || coalesce(E'\n\n' || nullif(btrim(coalesce(corpo, '')), ''), '');
  end case;
end;
$$;

revoke execute on function public.montar_texto_whatsapp(text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;

-- 3. A fila usa o texto bonito -------------------------------------------
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text);

create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null,
  cabecalho text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
  bonito text;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;
  end if;

  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  -- O texto do WhatsApp é montado por tipo, com emoji e link. Quando
  -- um botão de verdade vai junto (cloud) ou o salão pediu enquete, o
  -- "Responda 1" já não faz sentido — o montador ainda o inclui no
  -- lembrete; tudo bem: a cloud usa titulo+corpo próprios via botoes.
  bonito := public.montar_texto_whatsapp(tipo, cabecalho, texto, appt, prof, destinatario);

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, titulo, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, null, coalesce(bonito, texto), canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function
  public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 4. As respostas automáticas também ganham cara -----------------------
-- (só o texto muda; a lógica é a do 028)
create or replace function public.texto_resposta(tipo text, quando text, prof text)
returns text
language sql
immutable
as $$
  select case tipo
    when 'confirmado' then
      '✅ *Confirmado!* Te espero dia ' || quando || '. 💛'
    when 'cancelado' then
      '❌ Tudo bem, cancelei o seu horário de ' || quando || '.' || E'\n\n'
      || 'Quando quiser remarcar, é só abrir o app. 🙂'
    when 'sem_horario' then
      '🤔 Não encontrei nenhum horário marcado no seu nome.' || E'\n\n'
      || 'Se precisar, é só marcar pelo app.'
    when 'fora_de_contexto' then
      '👍 Recebi! Pra marcar ou mudar um horário, é só abrir o app.'
    when 'sair' then
      '👋 Pronto, não mando mais lembretes por aqui.' || E'\n'
      || 'Se mudar de ideia, é só ligar de novo no app.'
    when 'voto_repetido_confirmado' then
      'Sua resposta já foi registrada ✅ (horário confirmado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    when 'voto_repetido_cancelado' then
      'Sua resposta já foi registrada ❌ (horário cancelado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    else ''
  end;
$$;

revoke execute on function public.texto_resposta(text, text, text)
  from public, anon, authenticated;

-- 5. receber_resposta_whatsapp, agora respondendo bonito -------------
drop function if exists public.receber_resposta_whatsapp(text, text, text);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
  ja_votou record;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- o mesmo evento chegando duas vezes não age duas vezes
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);
  acao := public.interpretar_resposta(texto);

  -- ------------------------------------------------------------------
  -- Voto trocado na mesma enquete: o primeiro já valeu
  -- ------------------------------------------------------------------
  if id_enquete is not null then
    select i.acao, i.appointment_id into ja_votou
    from public.whatsapp_inbox i
    where i.enquete_id = id_enquete
      and i.acao in ('confirmado', 'cancelado')
    order by i.recebido_em
    limit 1;

    if found then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
      values (e164, texto, id_provedor, cliente, 'voto_repetido', ja_votou.appointment_id, id_enquete);

      select * into prof
      from public.professionals p
      join public.appointments a on a.professional_id = p.id
      where a.id = ja_votou.appointment_id;

      return jsonb_build_object(
        'acao', 'voto_repetido',
        'responder',
          public.texto_resposta('voto_repetido_' || ja_votou.acao, null, coalesce(prof.name, 'profissional'))
      );
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- Sair: vale mesmo para quem não tem conta no app
  -- ------------------------------------------------------------------
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox
      set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sair', id_enquete);

    return jsonb_build_object(
      'acao', 'sair',
      'responder', public.texto_resposta('sair', null, null)
    );
  end if;

  if cliente is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, acao, enquete_id)
    values (e164, texto, id_provedor, 'sem_cadastro', id_enquete);
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'nada', id_enquete);
    return jsonb_build_object('acao', 'nada');
  end if;

  -- 1 e 2 só mexem na agenda quando a conversa é sobre um horário
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto', id_enquete);
    return jsonb_build_object(
      'acao', 'fora_de_contexto',
      'responder', public.texto_resposta('fora_de_contexto', null, null)
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete);
    return jsonb_build_object(
      'acao', 'sem_horario',
      'responder', public.texto_resposta('sem_horario', null, null)
    );
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;

  if acao = 'confirma' then
    update public.appointments
    set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || to_char(appt.date, 'DD/MM') ||
        ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object(
      'acao', 'confirmado',
      'appointment_id', appt_id,
      'responder', public.texto_resposta('confirmado',
                     to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI'), null)
    );

  else
    update public.appointments
    set status = 'cancelado'
    where id = appt_id;

    resposta := jsonb_build_object(
      'acao', 'cancelado',
      'appointment_id', appt_id,
      'responder', public.texto_resposta('cancelado',
                     to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI'), null)
    );

    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || to_char(appt.date, 'DD/MM') ||
          ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id, id_enquete);

  return resposta;
end;
$$;

revoke execute on function public.receber_resposta_whatsapp(text, text, text, text)
  from public, anon, authenticated;

