-- 060 · ligar_relogio() recusa a chave errada na hora
--
-- A anon key e a service_role começam igual (eyJ…) e ficam lado a lado
-- no painel. Com a anon no Vault, o relógio chama as funções e leva
-- 401 "não autorizado" a cada minuto, sem nenhum erro no SQL. Agora a
-- função lê o papel dentro do token e explica na hora.
create or replace function public.papel_da_chave(chave text)
returns text
language plpgsql
immutable
as $$
declare carga text;
begin
  if chave like 'sb_secret_%' then return 'service_role'; end if;
  if chave like 'sb_publishable_%' then return 'anon'; end if;
  if chave not like 'eyJ%' then return null; end if;
  carga := translate(split_part(chave, '.', 2), '-_', '+/');
  carga := rpad(carga, ((length(carga) + 3) / 4) * 4, '=');
  return convert_from(decode(carga, 'base64'), 'utf8')::jsonb ->> 'role';
exception when others then
  return null;
end;
$$;

create or replace function public.ligar_relogio(url text, chave text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  existente uuid; nome text; valor text; primeiro jsonb; papel text;
begin
  url := btrim(url); chave := btrim(chave);
  if url !~ '^https://[a-z0-9-]+\.supabase\.co/?$' then
    raise exception 'A url tem de ser https://SEU_REF.supabase.co (veio %)', url;
  end if;
  papel := public.papel_da_chave(chave);
  if papel is null then
    raise exception 'Isso não parece uma chave do Supabase (começa com eyJ… ou sb_secret_).';
  end if;
  if papel <> 'service_role' then
    raise exception 'Essa é a chave "%", não a de serviço. No painel: Project Settings → API Keys → service_role (ou uma sb_secret_).', papel;
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
