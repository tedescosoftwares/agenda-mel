-- =============================================================
-- MIMO — 055: a plataforma — o olho que tudo vê
--
-- Até aqui existiam três papéis: cliente, profissional e admin (do
-- salão). Nenhum deles vê o MIMO inteiro: quantos salões, quem entrou
-- hoje, o que está preso na fila, se o relógio bate. Isso é papel de
-- quem CUIDA da plataforma, e é diferente de cuidar de um salão.
--
-- 'plataforma' é um quarto papel. Não é dona de salão nenhum (pode até
-- ser, com outra conta). Enxerga tudo por funções próprias, todas
-- travadas por eh_plataforma(), em vez de afrouxar as políticas das
-- tabelas — assim o que a cliente e o salão veem não muda um milímetro.
--
-- Dar o papel é uma linha no SQL Editor, de propósito: quem tem acesso
-- ao banco é quem decide quem é plataforma.
--
--   select public.dar_plataforma('voce@seudominio.com');
-- =============================================================

-- 1. O papel ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('cliente', 'profissional', 'admin', 'plataforma'));

create or replace function public.eh_plataforma()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'plataforma');
$$;

grant execute on function public.eh_plataforma() to authenticated;

-- só quem está no SQL Editor (postgres) chama isto
create or replace function public.dar_plataforma(email_ text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(email_));
  if uid is null then
    raise exception 'não existe conta com o e-mail %', email_;
  end if;
  update public.profiles set role = 'plataforma' where id = uid;
  return 'ok: ' || email_ || ' agora é plataforma';
end;
$$;

revoke execute on function public.dar_plataforma(text) from public, anon, authenticated;

-- uma plataforma pode promover outra pessoa pelo app
create or replace function public.promover_plataforma(email_ text)
returns text
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma promove'; end if;
  return public.dar_plataforma(email_);
end;
$$;

revoke execute on function public.promover_plataforma(text) from public, anon;
grant execute on function public.promover_plataforma(text) to authenticated;

-- o relógio responde para a plataforma também
create or replace function public.relogio_status()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  jobs jsonb;
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
    where j.jobname in ('mimo-fila', 'mimo-emails', 'mimo-rotinas')
  $q$ into jobs;
  return jsonb_build_object(
    'ligado', jsonb_array_length(jobs) > 0, 'jobs', jobs,
    'emails_na_fila', (select count(*) from public.email_outbox where status = 'na_fila'),
    'emails_falharam', (select count(*) from public.email_outbox where status = 'falhou'),
    'motivo', case when jsonb_array_length(jobs) = 0 then 'sem jobs — rode select public.ligar_relogio(url, chave)' end);
end;
$$;

-- 2. Os números gerais ----------------------------------------------------------------
create or replace function public.plataforma_resumo()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  hoje date := (public.agora_local())::date;
begin
  if not public.eh_plataforma() then return null; end if;
  return jsonb_build_object(
    'saloes', (select count(*) from public.salons where active and tipo = 'salao'),
    'autonomas', (select count(*) from public.salons where active and tipo = 'autonoma'),
    'profissionais', (select count(*) from public.professionals where active),
    'clientes', (select count(*) from public.profiles where role = 'cliente'),
    'vinculos', (select count(*) from public.vinculos where saiu_em is null),
    'clientes_sem_vinculo', (select count(*) from public.profiles p where p.role = 'cliente'
                             and not exists (select 1 from public.vinculos v where v.client_id = p.id and v.saiu_em is null)),
    'atendimentos_mes', (select count(*) from public.appointments
                         where status = 'concluido' and date >= date_trunc('month', hoje)::date),
    'agendados_futuro', (select count(*) from public.appointments
                         where status in ('pendente', 'confirmado') and date >= hoje),
    'novas_contas_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'whats_hoje', (select jsonb_build_object(
                     'na_fila', count(*) filter (where status = 'na_fila'),
                     'enviadas', count(*) filter (where status in ('enviado', 'entregue', 'lido')),
                     'falharam', count(*) filter (where status = 'falhou'))
                   from public.message_outbox
                   where (criado_em at time zone 'America/Sao_Paulo')::date = hoje),
    'emails', (select jsonb_build_object(
                 'na_fila', count(*) filter (where status = 'na_fila'),
                 'enviados', count(*) filter (where status = 'enviado'),
                 'falharam', count(*) filter (where status = 'falhou'))
               from public.email_outbox));
end;
$$;

revoke execute on function public.plataforma_resumo() from public, anon;
grant execute on function public.plataforma_resumo() to authenticated;

-- 3. Os salões (e autônomas) ---------------------------------------------------------
-- a 056 troca o tipo de retorno; sem o drop, rodar de novo quebra
drop function if exists public.plataforma_saloes();
create or replace function public.plataforma_saloes()
returns table (
  id uuid, nome text, tipo text, slug text, codigo text, cidade text, ativo boolean,
  dona text, dona_email text, profissionais integer, clientes integer,
  atendimentos integer, atendimentos_mes integer, ultimo_atendimento date, desde date
)
language sql
stable
security definer set search_path = public
as $$
  select s.id, s.name, s.tipo, s.slug, s.codigo, s.city, s.active,
         (select full_name from public.profiles where id = s.owner_id),
         (select email from auth.users where id = s.owner_id),
         (select count(*)::integer from public.professionals p where p.salon_id = s.id and p.active),
         (select count(*)::integer from public.vinculos v where v.salon_id = s.id and v.saiu_em is null),
         (select count(*)::integer from public.appointments a where a.salon_id = s.id and a.status = 'concluido'),
         (select count(*)::integer from public.appointments a where a.salon_id = s.id and a.status = 'concluido'
            and a.date >= date_trunc('month', (public.agora_local())::date)::date),
         (select max(a.date) from public.appointments a where a.salon_id = s.id and a.status = 'concluido'),
         s.created_at::date
  from public.salons s
  where public.eh_plataforma()
  order by s.active desc, s.created_at;
$$;

revoke execute on function public.plataforma_saloes() from public, anon;
grant execute on function public.plataforma_saloes() to authenticated;

-- um salão de perto: equipe, clientes e os últimos horários
create or replace function public.plataforma_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select case when public.eh_plataforma() then jsonb_build_object(
    'salao', (select to_jsonb(s) - 'brand_color' from public.salons s where s.id = salao),
    'dona', (select jsonb_build_object('nome', p.full_name, 'email', u.email, 'telefone', p.phone)
             from public.salons s left join public.profiles p on p.id = s.owner_id
             left join auth.users u on u.id = s.owner_id where s.id = salao),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', p.id, 'nome', p.name, 'slug', p.slug, 'codigo', p.codigo, 'ativa', p.active,
                 'tem_conta', p.user_id is not null, 'telefone', p.phone,
                 'trouxe', (select count(*) from public.vinculos v where v.trazida_por = p.id and v.saiu_em is null),
                 'atendimentos', (select count(*) from public.appointments a where a.professional_id = p.id and a.status = 'concluido'))
                 order by p.active desc, p.name), '[]'::jsonb)
               from public.professionals p where p.salon_id = salao),
    'clientes', (select coalesce(jsonb_agg(jsonb_build_object(
                   'nome', pf.full_name, 'telefone', pf.phone, 'entrou_em', v.criado_em, 'como', v.como,
                   'trazida_por', (select name from public.professionals where id = v.trazida_por))
                   order by v.criado_em desc), '[]'::jsonb)
                 from (select * from public.vinculos where salon_id = salao and saiu_em is null order by criado_em desc limit 100) v
                 join public.profiles pf on pf.id = v.client_id),
    'ultimos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'data', a.date, 'hora', to_char(a.start_time, 'HH24:MI'), 'status', a.status,
                  'servico', coalesce(a.service_name, sv.name), 'profissional', p.name,
                  'cliente', coalesce(pf.full_name, a.guest_name))
                  order by a.date desc, a.start_time desc), '[]'::jsonb)
                from (select * from public.appointments where salon_id = salao order by date desc, start_time desc limit 30) a
                left join public.services sv on sv.id = a.service_id
                left join public.professionals p on p.id = a.professional_id
                left join public.profiles pf on pf.id = a.client_id)
  ) end;
$$;

revoke execute on function public.plataforma_salao(uuid) from public, anon;
grant execute on function public.plataforma_salao(uuid) to authenticated;

-- ações de suporte
create or replace function public.plataforma_ativar_salao(salao uuid, ligar boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma'; end if;
  update public.salons set active = ligar where id = salao;
end;
$$;

create or replace function public.plataforma_trocar_dona(salao uuid, email_ text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(email_));
  if uid is null then raise exception 'não existe conta com o e-mail %', email_; end if;
  update public.salons set owner_id = uid where id = salao;
  insert into public.salon_members (salon_id, user_id, papel) values (salao, uid, 'admin') on conflict do nothing;
  update public.profiles set role = 'admin' where id = uid and role = 'cliente';
  return 'ok';
end;
$$;

revoke execute on function public.plataforma_ativar_salao(uuid, boolean) from public, anon;
grant execute on function public.plataforma_ativar_salao(uuid, boolean) to authenticated;
revoke execute on function public.plataforma_trocar_dona(uuid, text) from public, anon;
grant execute on function public.plataforma_trocar_dona(uuid, text) to authenticated;

-- 4. As pessoas ---------------------------------------------------------------------------
create or replace function public.plataforma_pessoas(busca text default null, quantas integer default 100)
returns table (
  id uuid, nome text, email text, telefone text, papel text, desde date,
  saloes text, vinculos integer, atendimentos integer, ultimo_acesso timestamptz
)
language sql
stable
security definer set search_path = public
as $$
  select p.id, p.full_name, u.email, p.phone, p.role, p.created_at::date,
         (select string_agg(distinct s.name, ', ')
          from public.salon_members m join public.salons s on s.id = m.salon_id where m.user_id = p.id),
         (select count(*)::integer from public.vinculos v where v.client_id = p.id and v.saiu_em is null),
         (select count(*)::integer from public.appointments a where a.client_id = p.id and a.status = 'concluido'),
         (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz  -- via jsonb: o auth.users de teste não tem a coluna
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.eh_plataforma()
    and (busca is null or btrim(busca) = ''
         or p.full_name ilike '%' || btrim(busca) || '%'
         or u.email ilike '%' || btrim(busca) || '%'
         or p.phone ilike '%' || btrim(busca) || '%')
  order by p.created_at desc
  limit greatest(1, least(coalesce(quantas, 100), 500));
$$;

revoke execute on function public.plataforma_pessoas(text, integer) from public, anon;
grant execute on function public.plataforma_pessoas(text, integer) to authenticated;

-- 5. As filas do sistema inteiro ------------------------------------------------------------
-- a 056 troca o tipo de retorno; sem o drop, rodar de novo quebra
drop function if exists public.plataforma_filas(integer);
create or replace function public.plataforma_filas(quantas integer default 60)
returns table (
  canal text, id uuid, quando timestamptz, salao text, para text, tipo text,
  status text, erro text, resumo text
)
language sql
stable
security definer set search_path = public
as $$
  (select 'whatsapp', o.id, coalesce(o.enviado_em, o.criado_em),
          (select name from public.salons where id = o.salon_id),
          o.telefone, o.kind, o.status, o.erro, left(o.corpo, 90)
   from public.message_outbox o
   where public.eh_plataforma()
   order by coalesce(o.enviado_em, o.criado_em) desc
   limit greatest(1, least(coalesce(quantas, 60), 200)))
  union all
  (select 'email', e.id, coalesce(e.enviado_em, e.criado_em), null,
          e.para, e.kind, e.status, e.erro, e.assunto
   from public.email_outbox e
   where public.eh_plataforma()
   order by coalesce(e.enviado_em, e.criado_em) desc
   limit greatest(1, least(coalesce(quantas, 60), 200)))
  order by 3 desc;
$$;

revoke execute on function public.plataforma_filas(integer) from public, anon;
grant execute on function public.plataforma_filas(integer) to authenticated;
