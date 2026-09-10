-- 059 · relogio_status() responde no SQL Editor
--
-- No SQL Editor não há usuário logado (auth.uid() é nulo), e a função
-- devolvia NULL em vez do estado do relógio — parecia que ligar_relogio
-- não tinha funcionado. Sem JWT só o próprio dono do banco chega aqui
-- (anon não tem execute), então sem uid é o dono perguntando.
create or replace function public.relogio_status()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare jobs jsonb;
begin
  if auth.uid() is not null and not (public.is_admin() or public.eh_plataforma()) then
    return jsonb_build_object('erro', 'só admin ou plataforma');
  end if;
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
    'vapid_public', (select left(c.valor, 12) || '…' from public.config_publica c where c.chave = 'vapid_public'),
    'app_url', (select c.valor from public.config_publica c where c.chave = 'app_url'),
    'motivo', case when jsonb_array_length(jobs) = 0 then 'sem jobs — rode select public.ligar_relogio(url, chave)' end);
end;
$$;
revoke execute on function public.relogio_status() from public, anon;
grant execute on function public.relogio_status() to authenticated;
