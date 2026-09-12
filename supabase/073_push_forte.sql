-- 073 · O push conta os não lidos
--
-- Cada push leva quantos avisos a pessoa tem sem ler, para o número
-- aparecer no ícone do app (Android e iPhone instalado). O relógio e a
-- função de envio não mudam de jeito; só a linha que puxar_push devolve
-- ganha a coluna nao_lidos.
drop function if exists public.puxar_push(integer);
create function public.puxar_push(quantos integer default 30)
returns table (
  notification_id uuid, user_id uuid, kind text, title text, body text, action_url text,
  celulares jsonb, nao_lidos integer
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
          from public.push_subscriptions s where s.user_id = m.user_id),
         (select count(*)::integer from public.notifications x
           where x.user_id = m.user_id and x.read_at is null
             and (x.expires_at is null or x.expires_at > now()))
  from marcados m;

  -- avisos antigos de quem não tem celular cadastrado: não ficam na fila
  update public.notifications set push_em = now(), push_resultado = 'sem celular'
  where push_em is null and created_at <= now() - interval '24 hours';
end;
$$;
revoke execute on function public.puxar_push(integer) from public, anon, authenticated;
