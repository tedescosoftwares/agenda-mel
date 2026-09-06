-- =============================================================
-- MIMO — 054: e-mail (boas-vindas e comunicações), pelo Resend
--
-- O WhatsApp é o canal do dia a dia; o e-mail é o canal do que fica:
-- boas-vindas, "sua conta de profissional está pronta", e o que mais
-- a casa quiser mandar depois. Mesmo desenho da fila de WhatsApp:
--
--   enfileirar_email()   escreve na fila (qualquer função do banco)
--   puxar_emails()       a função Edge enviar-email pega um lote
--   confirmar/falhar     ela escreve o resultado de volta
--   mimo-emails          o relógio (052) chama a função a cada minuto
--
-- A chave do Resend (RESEND_API_KEY) e o remetente (EMAIL_DE) ficam
-- como segredos da função Edge, nunca aqui:
--   supabase secrets set RESEND_API_KEY=re_... EMAIL_DE="MIMO <oi@seudominio.com>"
-- =============================================================

-- 1. A fila -----------------------------------------------------------------
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  para text not null,
  nome text,
  assunto text not null,
  html text not null,
  texto text,
  kind text not null default 'aviso',
  user_id uuid references public.profiles (id) on delete set null,
  status text not null default 'na_fila'
    check (status in ('na_fila', 'enviando', 'enviado', 'falhou', 'cancelado')),
  tentativas integer not null default 0,
  erro text,
  provider_id text,
  criado_em timestamptz not null default now(),
  liberado_em timestamptz not null default now(),
  enviado_em timestamptz
);

create index if not exists email_outbox_fila_idx
  on public.email_outbox (liberado_em) where status = 'na_fila';

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

create or replace function public.enfileirar_email(
  para text, assunto text, html text,
  kind text default 'aviso', texto text default null, nome text default null, conta uuid default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo uuid;
begin
  if para is null or para !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;
  insert into public.email_outbox (para, nome, assunto, html, texto, kind, user_id)
  values (lower(btrim(para)), nome, assunto, html, texto, kind, conta)
  returning id into novo;
  return novo;
end;
$$;

revoke execute on function public.enfileirar_email(text, text, text, text, text, text, uuid)
  from public, anon, authenticated;

-- lote para a função Edge: marca como 'enviando' na mesma transação
-- (skip locked), então duas execuções nunca pegam o mesmo e-mail
create or replace function public.puxar_emails(quantos integer default 20)
returns setof public.email_outbox
language plpgsql
security definer set search_path = public
as $$
begin
  -- travados há mais de 10 min voltam para a fila
  update public.email_outbox set status = 'na_fila'
  where status = 'enviando' and liberado_em < now() - interval '10 minutes';

  return query
  with lote as (
    select id from public.email_outbox
    where status = 'na_fila' and liberado_em <= now()
    order by criado_em
    limit greatest(1, least(coalesce(quantos, 20), 50))
    for update skip locked
  )
  update public.email_outbox o
  set status = 'enviando', tentativas = tentativas + 1, liberado_em = now()
  from lote where o.id = lote.id
  returning o.*;
end;
$$;

create or replace function public.confirmar_email(mensagem_id uuid, id_provedor text default null)
returns void
language sql
security definer set search_path = public
as $$
  update public.email_outbox
  set status = 'enviado', enviado_em = now(), provider_id = id_provedor, erro = null
  where id = mensagem_id;
$$;

create or replace function public.falhar_email(mensagem_id uuid, motivo text, permanente boolean default false)
returns void
language sql
security definer set search_path = public
as $$
  update public.email_outbox
  set status = case when permanente or tentativas >= 4 then 'falhou' else 'na_fila' end,
      erro = left(motivo, 500),
      -- espera crescente: 2, 8, 32 minutos
      liberado_em = now() + make_interval(mins => power(4, tentativas)::int * 2)
  where id = mensagem_id;
$$;

revoke execute on function public.puxar_emails(integer) from public, anon, authenticated;
revoke execute on function public.confirmar_email(uuid, text) from public, anon, authenticated;
revoke execute on function public.falhar_email(uuid, text, boolean) from public, anon, authenticated;

-- 2. O texto de boas-vindas -----------------------------------------------------
-- Curto, com a cara do MIMO e UMA ação: abrir o app. Quando veio por
-- convite, diz de quem.
create or replace function public.email_boas_vindas(nome text, quem_convidou text, papel text, link text)
returns table (assunto text, html text, texto text)
language plpgsql
immutable
as $$
declare
  primeiro text := coalesce(nullif(split_part(coalesce(nome, ''), ' ', 1), ''), 'Oi');
  corpo text;
  chamada text;
  assunto_ text;
begin
  if papel in ('autonoma', 'salao') then
    assunto_ := 'Sua agenda no MIMO está pronta 💛';
    corpo := 'Sua conta está aberta. O próximo passo é cadastrar seus serviços e horários — leva poucos minutos — e depois compartilhar seu código com as clientes: elas entram na sua agenda e passam a marcar sozinhas pelo app.';
    chamada := 'Abrir minha agenda';
  elsif quem_convidou is not null then
    assunto_ := 'Você entrou na agenda de ' || quem_convidou || ' 💛';
    corpo := quem_convidou || ' te convidou para o MIMO e você já está na agenda. Abra o app para ver os horários livres e marcar quando quiser. A confirmação chega no seu WhatsApp.';
    chamada := 'Ver horários';
  else
    assunto_ := 'Bem-vinda ao MIMO 💛';
    corpo := 'Sua conta está criada. Para ver horários e marcar, entre na agenda da sua profissional: peça o QR ou o código dela e escaneie pelo app.';
    chamada := 'Abrir o MIMO';
  end if;

  assunto := assunto_;
  texto := primeiro || ', ' || E'\n\n' || corpo || E'\n\n' || chamada || ': ' || link
           || E'\n\n' || 'MIMO — beleza na palma da mão';
  html :=
    '<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f2f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2026">'
    || '<div style="max-width:520px;margin:0 auto;padding:32px 20px">'
    || '<div style="background:#fff;border-radius:20px;padding:32px 28px;box-shadow:0 8px 30px rgba(61,12,78,.08)">'
    || '<div style="font-size:30px;font-weight:800;letter-spacing:-.02em;color:#aa4cff;margin-bottom:6px">mimo</div>'
    || '<div style="font-size:13px;color:#ff2d7a;margin-bottom:22px">beleza na palma da mão</div>'
    || '<p style="font-size:18px;margin:0 0 12px"><strong>' || primeiro || ',</strong></p>'
    || '<p style="font-size:15px;line-height:1.55;margin:0 0 24px;color:#3d3d44">' || corpo || '</p>'
    || '<a href="' || link || '" style="display:inline-block;background:linear-gradient(90deg,#ff2d7a,#ff7baa);color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:14px">' || chamada || '</a>'
    || '<p style="font-size:12px;color:#8a8a94;margin:28px 0 0">Se não foi você quem criou esta conta, é só ignorar este e-mail.</p>'
    || '</div></div></body></html>';
  return next;
end;
$$;

-- 3. O cadastro manda o e-mail -------------------------------------------------------
-- A mesma função de 053, com o passo (d): boas-vindas na fila. Nunca
-- derruba o cadastro.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  convite text := nullif(upper(btrim(meta ->> 'codigo_convite')), '');
  papel text := nullif(meta ->> 'papel_desejado', '');
  alvo jsonb;
  fone text;
  quem text;
  base text;
  e record;
begin
  insert into public.profiles (id, full_name, phone, referral_code)
  values (
    new.id,
    meta ->> 'full_name',
    meta ->> 'phone',
    public.gerar_codigo_indicacao(meta ->> 'full_name')
  );

  -- (a) veio por um código: entra na agenda antes de abrir o app
  if convite is not null then
    begin
      alvo := public.resolver_codigo(convite);
      if alvo is not null then
        perform public.vincular_interno(new.id, (alvo -> 'salao' ->> 'id')::uuid,
                                        (alvo ->> 'profissional_id')::uuid, 'cadastro');
        quem := alvo ->> 'nome';
        base := rtrim((select s.app_url from public.salons s where s.id = (alvo -> 'salao' ->> 'id')::uuid), '/');
      end if;
    exception when others then
      raise notice 'convite % não aplicado: %', convite, sqlerrm;
    end;
  end if;

  -- (b) já foi encaixada pelo telefone: os horários passam a ser dela, e o
  --     salão que a encaixou vira vínculo
  fone := public.telefone_e164(meta ->> 'phone');
  if fone is not null then
    begin
      update public.appointments a
      set client_id = new.id
      where a.client_id is null
        and public.telefone_e164(a.guest_phone) = fone;

      perform public.vincular_interno(new.id, a.salon_id, a.professional_id, 'encaixe')
      from (select distinct on (salon_id) salon_id, professional_id
            from public.appointments
            where client_id = new.id
            order by salon_id, date) a;
    exception when others then
      raise notice 'encaixes de % não amarrados: %', fone, sqlerrm;
    end;
  end if;

  -- (c) escolheu "sou profissional" / "tenho um salão" no cadastro
  if papel in ('autonoma', 'salao') then
    begin
      perform public.abrir_negocio_interno(new.id, papel, meta ->> 'nome_negocio', meta ->> 'cidade');
    exception when others then
      raise notice 'negócio de % não aberto: %', new.id, sqlerrm;
    end;
  end if;

  -- (d) boas-vindas na fila de e-mail
  begin
    if base is null then
      select rtrim(s.app_url, '/') into base from public.salons s where s.app_url is not null order by s.created_at limit 1;
    end if;
    select * into e from public.email_boas_vindas(meta ->> 'full_name', quem, papel, coalesce(base, '') || '/');
    perform public.enfileirar_email(new.email, e.assunto, e.html, 'boas_vindas', e.texto, meta ->> 'full_name', new.id);
  exception when others then
    raise notice 'boas-vindas de % não enfileirado: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;

-- 4. O relógio ganha o terceiro ponteiro -------------------------------------------------
create or replace function public.chutar_emails()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  url text; chave text; pedido bigint;
begin
  -- nada na fila, nada a chutar: não gasta pg_net à toa
  if not exists (select 1 from public.email_outbox where status = 'na_fila' and liberado_em <= now()) then
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
      rtrim(url, '/') || '/functions/v1/enviar-email',
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || chave)::text)
    into pedido;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'pg_net indisponível: ' || sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'pedido', pedido);
end;
$$;

revoke execute on function public.chutar_emails() from public, anon, authenticated;

-- ligar_relogio agenda os três; quem já ligou roda de novo e ganha o terceiro
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
  perform cron.schedule('mimo-rotinas', '*/5 * * * *', 'select public.rodar_rotinas()');

  primeiro := public.chutar_fila();
  return jsonb_build_object('ok', true,
    'jobs', array['mimo-fila (a cada minuto)', 'mimo-emails (a cada minuto)', 'mimo-rotinas (a cada 5 min)'],
    'primeiro_chute', primeiro);
end;
$$;

revoke execute on function public.ligar_relogio(text, text) from public, anon, authenticated;

create or replace function public.desligar_relogio()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  n integer := 0; j record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return jsonb_build_object('ok', true, 'motivo', 'pg_cron nem está ligado');
  end if;
  for j in select jobid from cron.job where jobname in ('mimo-fila', 'mimo-emails', 'mimo-rotinas') loop
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
declare
  jobs jsonb;
begin
  if not public.is_admin() then return null; end if;
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
    where j.jobname in ('mimo-fila', 'mimo-emails', 'mimo-rotinas')
  $q$ into jobs;
  return jsonb_build_object(
    'ligado', jsonb_array_length(jobs) > 0, 'jobs', jobs,
    'emails_na_fila', (select count(*) from public.email_outbox where status = 'na_fila'),
    'emails_falharam', (select count(*) from public.email_outbox where status = 'falhou'),
    'motivo', case when jsonb_array_length(jobs) = 0 then 'sem jobs — rode select public.ligar_relogio(url, chave)' end);
end;
$$;

revoke execute on function public.relogio_status() from public, anon;
grant execute on function public.relogio_status() to authenticated;
