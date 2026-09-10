-- =============================================================
-- MIMO — 057: push — o aviso chega no celular com o app fechado
--
-- Toda notificação do app (notificar()) já vira linha em notifications
-- e, quando cabe, mensagem de WhatsApp. Agora também vira PUSH: o
-- celular vibra com "Horário confirmado" mesmo com o MIMO fechado.
--
-- Funciona no Android e no iPhone (iOS 16.4+) desde que o MIMO esteja
-- instalado na tela inicial e a pessoa tenha tocado em "Ativar avisos".
--
-- Peças:
--   push_subscriptions   os celulares de cada pessoa (endpoint + chaves)
--   config_publica       a chave pública VAPID, lida pelo app sem login
--   puxar_push()         lote para a função Edge enviar-push
--   mimo-push            o quarto ponteiro do relógio, a cada minuto
--
-- As chaves VAPID nascem uma vez (npx web-push generate-vapid-keys):
--   pública  -> select public.definir_config_publica('vapid_public', '...');
--   privada  -> supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_SUBJECT=mailto:oi@mimo.com.vc
-- =============================================================

-- 1. Os celulares -------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  agente text,
  criado_em timestamptz not null default now(),
  ultimo_ok timestamptz,
  falhas integer not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "meus celulares" on public.push_subscriptions;
create policy "meus celulares"
  on public.push_subscriptions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke truncate, references, trigger on public.push_subscriptions from anon, authenticated;

-- 2. Configuração pública (a chave VAPID pública, e o que mais o app precisar sem login)
create table if not exists public.config_publica (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.config_publica enable row level security;
drop policy if exists "config publica e publica" on public.config_publica;
create policy "config publica e publica" on public.config_publica for select to anon, authenticated using (true);
grant select on public.config_publica to anon, authenticated;

create or replace function public.config_publica()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(chave, valor), '{}'::jsonb) from public.config_publica;
$$;
grant execute on function public.config_publica() to anon, authenticated;

create or replace function public.definir_config_publica(chave_ text, valor_ text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  -- pelo SQL Editor (postgres) ou por quem cuida da plataforma
  if auth.uid() is not null and not public.eh_plataforma() then
    raise exception 'só a plataforma';
  end if;
  insert into public.config_publica (chave, valor) values (chave_, valor_)
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
end;
$$;
revoke execute on function public.definir_config_publica(text, text) from public, anon;
grant execute on function public.definir_config_publica(text, text) to authenticated;

-- 3. O que ainda não foi empurrado -----------------------------------------------
alter table public.notifications add column if not exists push_em timestamptz;
alter table public.notifications add column if not exists push_resultado text;

create index if not exists notifications_push_idx
  on public.notifications (created_at) where push_em is null;

-- lote para a função Edge: cada linha é UM aviso com TODOS os celulares
-- da pessoa. Marca push_em na mesma transação (skip locked), então duas
-- execuções nunca empurram o mesmo aviso duas vezes.
create or replace function public.puxar_push(quantos integer default 30)
returns table (
  notification_id uuid, user_id uuid, kind text, title text, body text, action_url text,
  celulares jsonb
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with lote as (
    select n.id from public.notifications n
    where n.push_em is null
      and n.created_at > now() - interval '24 hours'
      and exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
    order by n.created_at
    limit greatest(1, least(coalesce(quantos, 30), 100))
    for update skip locked
  ),
  marcados as (
    update public.notifications n set push_em = now()
    from lote where n.id = lote.id
    returning n.*
  )
  select m.id, m.user_id, m.kind, m.title, m.body, m.action_url,
         (select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
          from public.push_subscriptions s where s.user_id = m.user_id)
  from marcados m;

  -- avisos antigos de quem não tem celular cadastrado: não ficam na fila
  update public.notifications set push_em = now(), push_resultado = 'sem celular'
  where push_em is null and created_at <= now() - interval '24 hours';
end;
$$;

create or replace function public.push_resultado(sub_id uuid, ok boolean, apagar boolean default false)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.push_subscriptions where id = sub_id and apagar;
  update public.push_subscriptions
  set ultimo_ok = case when ok then now() else ultimo_ok end,
      falhas = case when ok then 0 else falhas + 1 end
  where id = sub_id and not apagar;
$$;

revoke execute on function public.puxar_push(integer) from public, anon, authenticated;
revoke execute on function public.push_resultado(uuid, boolean, boolean) from public, anon, authenticated;

-- 4. O quarto ponteiro ----------------------------------------------------------------
create or replace function public.chutar_push()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  url text; chave text; pedido bigint;
begin
  if not exists (select 1 from public.notifications n where n.push_em is null and n.created_at > now() - interval '24 hours'
                 and exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)) then
    return jsonb_build_object('ok', true, 'vazio', true);
  end if;
  begin
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_url' $q$ into url;
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_service_role' $q$ into chave;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'Vault indisponível: ' || sqlerrm);
  end;
  if url is null or chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem credenciais — rode select public.ligar_relogio(url, chave)');
  end if;
  begin
    execute format(
      $q$ select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb, timeout_milliseconds := 30000) $q$,
      rtrim(url, '/') || '/functions/v1/enviar-push',
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || chave)::text)
    into pedido;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'pg_net indisponível: ' || sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'pedido', pedido);
end;
$$;

revoke execute on function public.chutar_push() from public, anon, authenticated;

create or replace function public.ligar_relogio(url text, chave text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  existente uuid; nome text; valor text; primeiro jsonb;
begin
  if url !~ '^https://[a-z0-9-]+\.supabase\.co/?$' then
    raise exception 'A url tem de ser https://SEU_REF.supabase.co (veio %)', url;
  end if;
  if chave !~ '^(eyJ|sb_secret_)' then
    raise exception 'Isso não parece a chave de SERVIÇO (começa com eyJ… ou sb_secret_).';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron não está ligado neste projeto. No painel: Database → Extensions → pg_cron (e pg_net).';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net não está ligado neste projeto. No painel: Database → Extensions → pg_net.';
  end if;
  for nome, valor in select * from (values ('mimo_url', rtrim(url, '/')), ('mimo_service_role', chave)) v(n, s) loop
    execute 'select id from vault.secrets where name = $1' into existente using nome;
    if existente is null then
      execute 'select vault.create_secret($1, $2, $3)' using valor, nome, 'MIMO: usado pelo relógio (052) para chamar as funções';
    else
      execute 'select vault.update_secret($1, $2)' using existente, valor;
    end if;
  end loop;
  perform cron.schedule('mimo-fila',    '* * * * *',   'select public.chutar_fila()');
  perform cron.schedule('mimo-emails',  '* * * * *',   'select public.chutar_emails()');
  perform cron.schedule('mimo-push',    '* * * * *',   'select public.chutar_push()');
  perform cron.schedule('mimo-rotinas', '*/5 * * * *', 'select public.rodar_rotinas()');
  primeiro := public.chutar_fila();
  return jsonb_build_object('ok', true,
    'jobs', array['mimo-fila', 'mimo-emails', 'mimo-push', 'mimo-rotinas (a cada 5 min)'],
    'primeiro_chute', primeiro);
end;
$$;
revoke execute on function public.ligar_relogio(text, text) from public, anon, authenticated;

create or replace function public.desligar_relogio()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare n integer := 0; j record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return jsonb_build_object('ok', true, 'motivo', 'pg_cron nem está ligado');
  end if;
  for j in select jobid from cron.job where jobname in ('mimo-fila', 'mimo-emails', 'mimo-push', 'mimo-rotinas') loop
    perform cron.unschedule(j.jobid); n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'desligados', n);
end;
$$;
revoke execute on function public.desligar_relogio() from public, anon, authenticated;

create or replace function public.relogio_status()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare jobs jsonb;
begin
  if not (public.is_admin() or public.eh_plataforma()) then return null; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return jsonb_build_object('ligado', false, 'motivo', 'pg_cron não está ligado neste projeto');
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'nome', j.jobname, 'agenda', j.schedule, 'ativo', j.active,
             'ultima', d.end_time, 'status', d.status, 'retorno', left(d.return_message, 200))
           order by j.jobname), '[]'::jsonb)
    from cron.job j
    left join lateral (select end_time, status, return_message from cron.job_run_details r
                       where r.jobid = j.jobid order by start_time desc limit 1) d on true
    where j.jobname in ('mimo-fila', 'mimo-emails', 'mimo-push', 'mimo-rotinas')
  $q$ into jobs;
  return jsonb_build_object(
    'ligado', jsonb_array_length(jobs) > 0, 'jobs', jobs,
    'emails_na_fila', (select count(*) from public.email_outbox where status = 'na_fila'),
    'emails_falharam', (select count(*) from public.email_outbox where status = 'falhou'),
    'push_celulares', (select count(*) from public.push_subscriptions),
    'push_pendentes', (select count(*) from public.notifications n where n.push_em is null and n.created_at > now() - interval '24 hours'),
    'motivo', case when jsonb_array_length(jobs) = 0 then 'sem jobs — rode select public.ligar_relogio(url, chave)' end);
end;
$$;
revoke execute on function public.relogio_status() from public, anon;
grant execute on function public.relogio_status() to authenticated;

-- o relógio de quem já ligou ganha o ponteiro novo sem precisar da chave de novo
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'mimo-fila')
     and not exists (select 1 from cron.job where jobname = 'mimo-push') then
    perform cron.schedule('mimo-push', '* * * * *', 'select public.chutar_push()');
  end if;
exception when others then
  raise notice 'mimo-push não agendado: %', sqlerrm;
end $$;
