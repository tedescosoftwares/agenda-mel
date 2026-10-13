-- 152: avisos nativos no app da loja (Expo Push).
-- O app (apps/mobile) registra o token do aparelho em push_tokens_app; a função
-- Edge enviar-push manda cada aviso também pelo Expo Push (FCM e APNs por trás),
-- além do Web Push do PWA. Quem só tem o app, sem PWA, passa a entrar na fila.
-- Nada muda para quem já recebe pelo PWA ou pelo WhatsApp.

-- 1. Os aparelhos ---------------------------------------------------------------------
create table if not exists public.push_tokens_app (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,                       -- ExponentPushToken[...]
  plataforma text not null check (plataforma in ('android', 'ios')),
  variante text not null default 'cliente' check (variante in ('cliente', 'pro')),
  aparelho text,                                    -- "Samsung SM-A515F android 14", só para a Plataforma entender
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  ultimo_ok timestamptz,
  falhas integer not null default 0
);
create index if not exists push_tokens_app_user_idx on public.push_tokens_app (user_id);
alter table public.push_tokens_app enable row level security;
drop policy if exists "tokens do app: cada um os seus" on public.push_tokens_app;
create policy "tokens do app: cada um os seus" on public.push_tokens_app
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_tokens_app to authenticated;

-- 2. O app registra ao entrar (e sempre que o token mudar) e remove ao sair -----------
create or replace function public.registrar_token_app(token_ text, plataforma_ text, variante_ text default 'cliente', aparelho_ text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  if coalesce(token_, '') = '' then raise exception 'token vazio'; end if;
  insert into public.push_tokens_app (user_id, token, plataforma, variante, aparelho)
  values (auth.uid(), token_, plataforma_, coalesce(variante_, 'cliente'), left(aparelho_, 120))
  on conflict (token) do update
    set user_id = excluded.user_id, plataforma = excluded.plataforma, variante = excluded.variante,
        aparelho = excluded.aparelho, atualizado_em = now(), falhas = 0;
end;
$$;
revoke execute on function public.registrar_token_app(text, text, text, text) from public, anon;
grant execute on function public.registrar_token_app(text, text, text, text) to authenticated;

create or replace function public.remover_token_app(token_ text)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.push_tokens_app where token = token_ and user_id = auth.uid();
$$;
revoke execute on function public.remover_token_app(text) from public, anon;
grant execute on function public.remover_token_app(text) to authenticated;

-- 3. O resultado de cada envio: ok zera as falhas; aparelho que sumiu é apagado -------
create or replace function public.token_app_resultado(token_id uuid, ok boolean, apagar boolean default false)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.push_tokens_app where id = token_id and apagar;
  update public.push_tokens_app
  set ultimo_ok = case when ok then now() else ultimo_ok end,
      falhas = case when ok then 0 else falhas + 1 end
  where id = token_id and not apagar;
$$;
revoke execute on function public.token_app_resultado(uuid, boolean, boolean) from public, anon, authenticated;

-- 4. A fila: a mesma de sempre (057/073), agora com os aparelhos do app em cada
--    linha, e quem só tem o app também entra ------------------------------------------
drop function if exists public.puxar_push(integer);
create function public.puxar_push(quantos integer default 30)
returns table (
  notification_id uuid, user_id uuid, kind text, title text, body text, action_url text,
  celulares jsonb, nao_lidos integer, aparelhos jsonb
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
      and (exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
        or exists (select 1 from public.push_tokens_app t where t.user_id = n.user_id))
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
          from public.push_subscriptions s where s.user_id = m.user_id),
         (select count(*)::integer from public.notifications x
           where x.user_id = m.user_id and x.read_at is null
             and (x.expires_at is null or x.expires_at > now())),
         (select jsonb_agg(jsonb_build_object('id', t.id, 'token', t.token, 'plataforma', t.plataforma))
          from public.push_tokens_app t where t.user_id = m.user_id)
  from marcados m;

  -- avisos antigos de quem não tem celular nem app cadastrado: não ficam na fila
  update public.notifications set push_em = now(), push_resultado = 'sem celular'
  where push_em is null and created_at <= now() - interval '24 hours';
end;
$$;
revoke execute on function public.puxar_push(integer) from public, anon, authenticated;

do $$ begin raise notice '152: push_tokens_app, registrar/remover_token_app, token_app_resultado e puxar_push com aparelhos'; end $$;
