-- =============================================================
-- MIMO — 052: o relógio da casa (pg_cron + pg_net)
--
-- Até aqui NADA acontecia sozinho no banco. Prazo de aceite vencido,
-- oferta da lista de espera expirada, lembrete de véspera, mensagem
-- parada na fila: tudo dependia de alguém abrir o app (o app chama
-- enviar_lembretes() ao abrir) ou do cron da VPS rodar disparar.sh de
-- minuto em minuto. Funcionou, mas é um relógio fora da casa: se a VPS
-- cai, o MIMO para de avisar e ninguém percebe.
--
-- Agora o relógio mora no próprio Supabase:
--
--   • pg_cron   agenda a hora
--   • pg_net    bate na função enviar-whatsapp, que fala com a Evolution
--   • Vault     guarda a chave de serviço, cifrada, fora do código
--
-- Dois ponteiros:
--   mimo-fila      a cada minuto     chutar_fila()   -> enviar-whatsapp
--   mimo-rotinas   a cada 5 minutos  rodar_rotinas() -> prazos, ofertas,
--                                                      lembretes
--
-- Ligar é uma chamada no SQL Editor, uma vez:
--
--   select public.ligar_relogio('https://SEU_REF.supabase.co', 'CHAVE_DE_SERVICO');
--
-- Conferir:  select public.relogio_status();
-- Desligar:  select public.desligar_relogio();
--
-- Este arquivo roda também onde não existe pg_cron nem Vault (o teste
-- local, por exemplo): nada quebra, as funções só respondem "indisponível".
-- =============================================================

-- 1. As extensões, se a casa tiver ------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron não disponível aqui (%). O relógio fica desligado.', sqlerrm;
  end;
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net não disponível aqui (%). O relógio fica desligado.', sqlerrm;
  end;
end $$;

-- 2. As rotinas do banco, numa chamada -----------------------------------------
-- O que já existia espalhado, junto, para o cron chamar um nome só.
create or replace function public.rodar_rotinas()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  vencidos integer := 0;
  ofertas integer := 0;
  lembretes integer := 0;
begin
  vencidos  := coalesce(public.resolver_aceites_vencidos(), 0);
  ofertas   := coalesce(public.avancar_ofertas_expiradas(), 0);
  lembretes := coalesce(public.enviar_lembretes(), 0);
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'em', now());
end;
$$;

revoke execute on function public.rodar_rotinas() from public, anon, authenticated;

-- 3. O chute na fila -------------------------------------------------------------
-- Lê a URL do projeto e a chave de serviço do Vault e faz um POST na
-- função enviar-whatsapp. É assíncrono (pg_net): o cron não fica preso
-- esperando a Evolution mandar 20 mensagens.
create or replace function public.chutar_fila()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  url text;
  chave text;
  pedido bigint;
begin
  begin
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_url' $q$ into url;
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_service_role' $q$ into chave;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'Vault indisponível: ' || sqlerrm);
  end;

  if url is null or chave is null then
    return jsonb_build_object('ok', false,
      'motivo', 'sem credenciais — rode select public.ligar_relogio(url, chave)');
  end if;

  begin
    execute format(
      $q$ select net.http_post(
            url := %L,
            headers := %L::jsonb,
            body := '{}'::jsonb,
            timeout_milliseconds := 30000) $q$,
      rtrim(url, '/') || '/functions/v1/enviar-whatsapp',
      jsonb_build_object('Content-Type', 'application/json',
                         'Authorization', 'Bearer ' || chave)::text)
    into pedido;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'pg_net indisponível: ' || sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'pedido', pedido);
end;
$$;

revoke execute on function public.chutar_fila() from public, anon, authenticated;

-- 4. Ligar -----------------------------------------------------------------------
create or replace function public.ligar_relogio(url text, chave text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  existente uuid;
  nome text;
  valor text;
  primeiro jsonb;
begin
  if url !~ '^https://[a-z0-9-]+\.supabase\.co/?$' then
    raise exception 'A url tem de ser https://SEU_REF.supabase.co (veio %)', url;
  end if;
  if chave !~ '^(eyJ|sb_secret_)' then
    raise exception 'Isso não parece a chave de SERVIÇO (começa com eyJ… ou sb_secret_). A anon não serve: é ela que a função exige.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron não está ligado neste projeto. No painel: Database → Extensions → pg_cron (e pg_net).';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net não está ligado neste projeto. No painel: Database → Extensions → pg_net.';
  end if;

  -- os dois segredos no Vault (cria ou atualiza)
  for nome, valor in select * from (values ('mimo_url', rtrim(url, '/')),
                                          ('mimo_service_role', chave)) v(n, s) loop
    execute 'select id from vault.secrets where name = $1' into existente using nome;
    if existente is null then
      execute 'select vault.create_secret($1, $2, $3)'
        using valor, nome, 'MIMO: usado pelo relógio (052) para chamar enviar-whatsapp';
    else
      execute 'select vault.update_secret($1, $2)' using existente, valor;
    end if;
  end loop;

  -- os ponteiros (cron.schedule com nome repetido substitui, não duplica)
  perform cron.schedule('mimo-fila',    '* * * * *',   'select public.chutar_fila()');
  perform cron.schedule('mimo-rotinas', '*/5 * * * *', 'select public.rodar_rotinas()');

  -- e um primeiro chute agora, para não esperar o minuto virar
  primeiro := public.chutar_fila();

  return jsonb_build_object('ok', true,
    'jobs', array['mimo-fila (a cada minuto)', 'mimo-rotinas (a cada 5 min)'],
    'primeiro_chute', primeiro,
    'dica', 'na VPS, ./disparar.sh --sem-cron tira o relógio antigo');
end;
$$;

revoke execute on function public.ligar_relogio(text, text) from public, anon, authenticated;

-- 5. Desligar ----------------------------------------------------------------------
create or replace function public.desligar_relogio()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  n integer := 0;
  j record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return jsonb_build_object('ok', true, 'motivo', 'pg_cron nem está ligado');
  end if;
  for j in select jobid, jobname from cron.job where jobname in ('mimo-fila', 'mimo-rotinas') loop
    perform cron.unschedule(j.jobid);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'desligados', n);
end;
$$;

revoke execute on function public.desligar_relogio() from public, anon, authenticated;

-- 6. Está batendo? ------------------------------------------------------------------
-- Para a tela do admin e para o SQL Editor. Diz se o relógio existe,
-- quando bateu pela última vez e se deu erro.
create or replace function public.relogio_status()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  jobs jsonb;
begin
  if not public.is_admin() then
    return null;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return jsonb_build_object('ligado', false, 'motivo', 'pg_cron não está ligado neste projeto');
  end if;

  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'nome', j.jobname,
             'agenda', j.schedule,
             'ativo', j.active,
             'ultima', d.end_time,
             'status', d.status,
             'retorno', left(d.return_message, 200))
           order by j.jobname), '[]'::jsonb)
    from cron.job j
    left join lateral (
      select end_time, status, return_message
      from cron.job_run_details r
      where r.jobid = j.jobid
      order by start_time desc
      limit 1
    ) d on true
    where j.jobname in ('mimo-fila', 'mimo-rotinas')
  $q$ into jobs;

  return jsonb_build_object(
    'ligado', jsonb_array_length(jobs) > 0,
    'jobs', jobs,
    'motivo', case when jsonb_array_length(jobs) = 0
                   then 'sem jobs — rode select public.ligar_relogio(url, chave)' end);
end;
$$;

revoke execute on function public.relogio_status() from public, anon;
grant execute on function public.relogio_status() to authenticated;
