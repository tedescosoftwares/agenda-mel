-- shim: o que o Supabase dá de graça e o Postgres pelado não tem.
-- Só para o banco de testes (testar.sh); nunca vai para a produção.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
end $$;
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists vault;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;

-- auth
create table if not exists auth.users (
  instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text,
  email text, encrypted_password text, email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  is_super_admin boolean, created_at timestamptz default now(), updated_at timestamptz default now(),
  confirmation_token text, recovery_token text, email_change text, email_change_token_new text, deleted_at timestamptz
);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id) on delete cascade,
  identity_data jsonb, provider text, provider_id text, last_sign_in_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(), email text
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon')
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- storage
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid,
  metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
create or replace function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(storage.filename(name)), '.', 1))
$$;

-- cron (guarda os jobs, não roda nada)
create table if not exists cron.job (jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport int default 5432, database text, username text, active boolean default true, jobname text unique);
create table if not exists cron.job_run_details (runid bigserial primary key, jobid bigint, job_pid int, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$
declare j bigint;
begin
  insert into cron.job (schedule, command, jobname, database, username) values (schedule, command, job_name, current_database(), current_user)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid into j;
  return j;
end $$;
create or replace function cron.schedule(schedule text, command text) returns bigint language plpgsql as $$
declare j bigint;
begin
  insert into cron.job (schedule, command, database, username) values (schedule, command, current_database(), current_user) returning jobid into j;
  return j;
end $$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin delete from cron.job where jobname = job_name; return found; end $$;
create or replace function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$
begin delete from cron.job where jobid = job_id; return found; end $$;

-- net (engole a chamada)
create table if not exists net._http_response (id bigserial primary key, status_code int, content_type text, headers jsonb, content text, timed_out boolean, error_msg text, created timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$
  select 1::bigint
$$;
create or replace function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$
  select 1::bigint
$$;

-- vault
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text, key_id uuid, nonce bytea, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, key_id, nonce, created_at, updated_at from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid language plpgsql as $$
declare i uuid;
begin insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id into i; return i; end $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void language plpgsql as $$
begin update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description), updated_at = now() where id = secret_id; end $$;

-- realtime
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
