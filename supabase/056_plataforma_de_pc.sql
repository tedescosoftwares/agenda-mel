-- =============================================================
-- MIMO — 056: a plataforma vira painel de PC
--
-- A 055 trouxe o papel e as leituras básicas. O painel desenhado pede
-- mais: cada número com "vs. mês anterior" e uma linha de tendência de
-- oito semanas, a atividade recente do sistema inteiro, o funil de
-- convites, a lista de vínculos com origem/destino/canal, o checklist
-- de implantação de cada unidade, e a criação de um salão pela própria
-- plataforma. Tudo continua travado por eh_plataforma().
-- =============================================================

-- 1. Números com variação e tendência ------------------------------------------
-- Cada métrica devolve valor atual, valor no período anterior e a série
-- das últimas 8 semanas (para a linha do card).
create or replace function public.plataforma_kpis()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  hoje date := (public.agora_local())::date;
  ini_mes date := date_trunc('month', hoje)::date;
  ini_ant date := (date_trunc('month', hoje) - interval '1 month')::date;
  r jsonb := '{}'::jsonb;
begin
  if not public.eh_plataforma() then return null; end if;

  -- séries semanais: quantos EXISTIAM no fim de cada semana (acumulado)
  -- ou quantos ACONTECERAM na semana (fluxo), conforme a métrica
  with semanas as (
    select (hoje - (7 * n))::date as fim from generate_series(7, 0, -1) n
  ),
  s as (
    select
      jsonb_agg((select count(*) from public.salons x where x.tipo = 'salao' and x.active and x.created_at::date <= w.fim) order by w.fim) as saloes,
      jsonb_agg((select count(*) from public.salons x where x.tipo = 'autonoma' and x.active and x.created_at::date <= w.fim) order by w.fim) as autonomas,
      jsonb_agg((select count(*) from public.professionals x where x.active and x.created_at::date <= w.fim) order by w.fim) as profissionais,
      jsonb_agg((select count(*) from public.profiles x where x.role = 'cliente' and x.created_at::date <= w.fim) order by w.fim) as clientes,
      jsonb_agg((select count(*) from public.vinculos x where x.saiu_em is null and x.criado_em::date <= w.fim) order by w.fim) as vinculos,
      jsonb_agg((select count(*) from public.profiles x where x.created_at::date > w.fim - 7 and x.created_at::date <= w.fim) order by w.fim) as contas,
      jsonb_agg((select count(*) from public.appointments x where x.status = 'concluido' and x.date > w.fim - 7 and x.date <= w.fim) order by w.fim) as atendimentos,
      jsonb_agg((select count(*) from public.appointments x where x.status in ('pendente','confirmado') and x.created_at::date <= w.fim and x.date > w.fim) order by w.fim) as marcados
    from semanas w
  )
  select jsonb_build_object(
    'saloes', jsonb_build_object(
      'valor', (select count(*) from public.salons where tipo = 'salao' and active),
      'anterior', (select count(*) from public.salons where tipo = 'salao' and active and created_at < ini_mes),
      'serie', s.saloes),
    'autonomas', jsonb_build_object(
      'valor', (select count(*) from public.salons where tipo = 'autonoma' and active),
      'anterior', (select count(*) from public.salons where tipo = 'autonoma' and active and created_at < ini_mes),
      'serie', s.autonomas),
    'profissionais', jsonb_build_object(
      'valor', (select count(*) from public.professionals where active),
      'anterior', (select count(*) from public.professionals where active and created_at < ini_mes),
      'serie', s.profissionais),
    'clientes', jsonb_build_object(
      'valor', (select count(*) from public.profiles where role = 'cliente'),
      'anterior', (select count(*) from public.profiles where role = 'cliente' and created_at < ini_mes),
      'serie', s.clientes),
    'vinculos', jsonb_build_object(
      'valor', (select count(*) from public.vinculos where saiu_em is null),
      'anterior', (select count(*) from public.vinculos where saiu_em is null and criado_em < ini_mes),
      'serie', s.vinculos),
    'contas_7d', jsonb_build_object(
      'valor', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
      'anterior', (select count(*) from public.profiles where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
      'serie', s.contas),
    'atendimentos_mes', jsonb_build_object(
      'valor', (select count(*) from public.appointments where status = 'concluido' and date >= ini_mes),
      'anterior', (select count(*) from public.appointments where status = 'concluido' and date >= ini_ant and date < ini_mes),
      'serie', s.atendimentos),
    'marcados', jsonb_build_object(
      'valor', (select count(*) from public.appointments where status in ('pendente','confirmado') and date >= hoje),
      'anterior', (select count(*) from public.appointments where status in ('pendente','confirmado') and date >= hoje - 1 and created_at < hoje),
      'serie', s.marcados),
    'sem_vinculo', jsonb_build_object(
      'valor', (select count(*) from public.profiles p where p.role = 'cliente'
                and not exists (select 1 from public.vinculos v where v.client_id = p.id and v.saiu_em is null)),
      'anterior', null, 'serie', null),
    'whats_hoje', (select jsonb_build_object(
        'enviadas', count(*) filter (where status in ('enviado','entregue','lido')),
        'na_fila', count(*) filter (where status = 'na_fila'),
        'falharam', count(*) filter (where status = 'falhou'))
      from public.message_outbox where (criado_em at time zone 'America/Sao_Paulo')::date = hoje),
    'whats_falhas_24h', (select count(*) from public.message_outbox where status = 'falhou' and criado_em >= now() - interval '24 hours'),
    'emails', (select jsonb_build_object(
        'enviados', count(*) filter (where status = 'enviado'),
        'na_fila', count(*) filter (where status = 'na_fila'),
        'falharam', count(*) filter (where status = 'falhou'))
      from public.email_outbox)
  ) into r from s;
  return r;
end;
$$;

revoke execute on function public.plataforma_kpis() from public, anon;
grant execute on function public.plataforma_kpis() to authenticated;

-- 2. Atividade recente, do sistema inteiro ----------------------------------------
create or replace function public.plataforma_atividade(quantas integer default 20)
returns table (tipo text, titulo text, detalhe text, quando timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select * from (
    select 'salao'::text as tipo,
           ('Novo ' || case when s.tipo = 'autonoma' then 'agenda autônoma' else 'salão' end)::text as titulo,
           (s.name || case when s.city is not null then ' · ' || s.city else '' end)::text as detalhe,
           s.created_at as quando
    from public.salons s
    union all
    select 'profissional', 'Profissional criada', p.name || ' · ' || (select name from public.salons where id = p.salon_id), p.created_at
    from public.professionals p
    union all
    select 'cliente', 'Nova conta', coalesce(pf.full_name, 'sem nome') || ' · ' || pf.role, pf.created_at
    from public.profiles pf
    union all
    select 'vinculo', 'Cliente entrou na agenda',
           coalesce((select full_name from public.profiles where id = v.client_id), 'cliente') || ' → '
           || (select name from public.salons where id = v.salon_id) || ' · por ' || v.como, v.criado_em
    from public.vinculos v
    union all
    select 'atendimento', 'Atendimento concluído',
           coalesce(a.service_name, (select name from public.services where id = a.service_id), 'serviço') || ' · '
           || coalesce((select full_name from public.profiles where id = a.client_id), a.guest_name, 'cliente')
           || ' com ' || (select name from public.professionals where id = a.professional_id),
           (a.date + a.end_time) at time zone 'America/Sao_Paulo'
    from public.appointments a where a.status = 'concluido' and a.date >= (public.agora_local())::date - 30
  ) x
  where public.eh_plataforma()
  order by quando desc
  limit greatest(1, least(coalesce(quantas, 20), 100));
$$;

revoke execute on function public.plataforma_atividade(integer) from public, anon;
grant execute on function public.plataforma_atividade(integer) to authenticated;

-- 3. Convites e vínculos ---------------------------------------------------------------
create or replace function public.plataforma_vinculos(quantas integer default 100)
returns table (
  id uuid, pessoa text, contato text, origem text, origem_tipo text,
  destino text, destino_tipo text, canal text, ativo boolean, criado_em timestamptz, saiu_em timestamptz
)
language sql
stable
security definer set search_path = public
as $$
  select v.id,
         coalesce(pf.full_name, 'sem nome'),
         coalesce(pf.phone, (select email from auth.users where id = pf.id)),
         case when tp.id is not null then 'Código da ' || tp.name
              when v.como in ('vitrine','agendamento') then 'Agendou'
              when v.como = 'encaixe' then 'Encaixe pelo telefone'
              else 'Código do salão' end,
         case when tp.id is not null then 'profissional' else 'salao' end,
         s.name, s.tipo, v.como, v.saiu_em is null, v.criado_em, v.saiu_em
  from public.vinculos v
  join public.profiles pf on pf.id = v.client_id
  join public.salons s on s.id = v.salon_id
  left join public.professionals tp on tp.id = v.trazida_por
  where public.eh_plataforma()
  order by v.criado_em desc
  limit greatest(1, least(coalesce(quantas, 100), 500));
$$;

revoke execute on function public.plataforma_vinculos(integer) from public, anon;
grant execute on function public.plataforma_vinculos(integer) to authenticated;

-- funil e canais: quantas contas de cliente, quantas com vínculo, por onde entraram
create or replace function public.plataforma_funil()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select case when public.eh_plataforma() then jsonb_build_object(
    'contas', (select count(*) from public.profiles where role = 'cliente'),
    'com_vinculo', (select count(distinct client_id) from public.vinculos where saiu_em is null),
    'sem_vinculo', (select count(*) from public.profiles p where p.role = 'cliente'
                    and not exists (select 1 from public.vinculos v where v.client_id = p.id and v.saiu_em is null)),
    'sairam', (select count(*) from public.vinculos where saiu_em is not null),
    'canais', (select coalesce(jsonb_agg(jsonb_build_object('canal', c.como, 'quantos', c.n) order by c.n desc), '[]'::jsonb)
               from (select como, count(*) n from public.vinculos group by como) c),
    'destinos', (select coalesce(jsonb_agg(jsonb_build_object('nome', d.nome, 'tipo', d.tipo, 'quantos', d.n) order by d.n desc), '[]'::jsonb)
                 from (select s.name nome, s.tipo, count(*) n from public.vinculos v join public.salons s on s.id = v.salon_id
                       where v.saiu_em is null group by s.name, s.tipo limit 8) d)
  ) end;
$$;

revoke execute on function public.plataforma_funil() from public, anon;
grant execute on function public.plataforma_funil() to authenticated;

-- 4. Salões: mais campos para o checklist de implantação --------------------------------
drop function if exists public.plataforma_saloes();
create or replace function public.plataforma_saloes()
returns table (
  id uuid, nome text, tipo text, slug text, codigo text, cidade text, ativo boolean,
  dona text, dona_email text, profissionais integer, clientes integer, servicos integer,
  tem_horario boolean, atendimentos integer, atendimentos_mes integer, ultimo_atendimento date, desde date
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
         (select count(*)::integer from public.services sv where sv.salon_id = s.id and sv.active),
         exists (select 1 from public.business_hours h where h.salon_id = s.id and h.open),
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

-- criar um salão pela plataforma: com dona já cadastrada (e-mail) ou sem dona ainda
create or replace function public.plataforma_criar_salao(nome text, cidade text default null, tipo text default 'salao', email_dona text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid; salao uuid; base text; s text; i integer := 0;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma'; end if;
  if nullif(btrim(nome), '') is null then raise exception 'o salão precisa de um nome'; end if;
  if tipo not in ('salao', 'autonoma') then raise exception 'tipo tem de ser salao ou autonoma'; end if;
  if nullif(btrim(email_dona), '') is not null then
    select id into uid from auth.users where lower(email) = lower(btrim(email_dona));
    if uid is null then raise exception 'não existe conta com o e-mail %; peça para a pessoa criar a conta antes', email_dona; end if;
  end if;
  base := coalesce(nullif(public.slug_de(nome), ''), 'salao'); s := base;
  while exists (select 1 from public.salons where slug = s) loop i := i + 1; s := base || '-' || i; end loop;
  insert into public.salons (name, slug, owner_id, city, tipo) values (btrim(nome), s, uid, nullif(btrim(cidade), ''), tipo)
  returning id into salao;
  if uid is not null then
    insert into public.salon_members (salon_id, user_id, papel) values (salao, uid, 'admin') on conflict do nothing;
    update public.profiles set role = 'admin' where id = uid and role = 'cliente';
    if tipo = 'autonoma' and not exists (select 1 from public.professionals where user_id = uid) then
      insert into public.professionals (salon_id, user_id, name, slug, phone)
      select salao, uid, coalesce(full_name, nome), s, phone from public.profiles where id = uid;
      update public.profiles set role = 'profissional' where id = uid;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', salao, 'slug', s, 'codigo', (select codigo from public.salons where id = salao));
end;
$$;

revoke execute on function public.plataforma_criar_salao(text, text, text, text) from public, anon;
grant execute on function public.plataforma_criar_salao(text, text, text, text) to authenticated;

-- 5. Filas com mais colunas, e os logs do relógio ----------------------------------------
drop function if exists public.plataforma_filas(integer);
create or replace function public.plataforma_filas(quantas integer default 60)
returns table (
  canal text, id uuid, quando timestamptz, salao text, para text, nome text, tipo text,
  status text, tentativas integer, agendado timestamptz, erro text, resumo text
)
language sql
stable
security definer set search_path = public
as $$
  (select 'whatsapp', o.id, coalesce(o.enviado_em, o.criado_em),
          (select name from public.salons where id = o.salon_id),
          o.telefone, (select full_name from public.profiles where id = o.client_id),
          o.kind, o.status, o.tentativas, o.liberado_em, o.erro, left(o.corpo, 90)
   from public.message_outbox o
   where public.eh_plataforma()
   order by coalesce(o.enviado_em, o.criado_em) desc
   limit greatest(1, least(coalesce(quantas, 60), 300)))
  union all
  (select 'email', e.id, coalesce(e.enviado_em, e.criado_em), null,
          e.para, e.nome, e.kind, e.status, e.tentativas, e.liberado_em, e.erro, e.assunto
   from public.email_outbox e
   where public.eh_plataforma()
   order by coalesce(e.enviado_em, e.criado_em) desc
   limit greatest(1, least(coalesce(quantas, 60), 300)))
  order by 3 desc;
$$;

revoke execute on function public.plataforma_filas(integer) from public, anon;
grant execute on function public.plataforma_filas(integer) to authenticated;

create or replace function public.plataforma_logs(quantas integer default 20)
returns table (tipo text, titulo text, detalhe text, ok boolean, quando timestamptz)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then return; end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    return query execute format($q$
      select 'relogio'::text, 'Relógio: ' || j.jobname, coalesce(left(d.return_message, 120), ''),
             d.status = 'succeeded', d.end_time
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where j.jobname in ('mimo-fila','mimo-emails','mimo-rotinas') and d.end_time is not null
      order by d.end_time desc limit %s $q$, greatest(1, least(coalesce(quantas, 20), 100)));
  end if;
  return query
    select 'whatsapp'::text, 'WhatsApp falhou', coalesce(o.erro, '') || ' · ' || o.telefone, false, o.criado_em
    from public.message_outbox o where o.status = 'falhou'
    order by o.criado_em desc limit greatest(1, least(coalesce(quantas, 20), 100));
  return query
    select 'email'::text, 'E-mail falhou', coalesce(e.erro, '') || ' · ' || e.para, false, e.criado_em
    from public.email_outbox e where e.status = 'falhou'
    order by e.criado_em desc limit greatest(1, least(coalesce(quantas, 20), 100));
end;
$$;

revoke execute on function public.plataforma_logs(integer) from public, anon;
grant execute on function public.plataforma_logs(integer) to authenticated;

-- 6. Séries para Métricas: por semana, 12 semanas ------------------------------------------
create or replace function public.plataforma_series(semanas integer default 12)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with w as (
    select ((public.agora_local())::date - 7 * n)::date as fim from generate_series(greatest(1, least(coalesce(semanas, 12), 52)) - 1, 0, -1) n
  )
  select case when public.eh_plataforma() then jsonb_agg(jsonb_build_object(
    'fim', w.fim,
    'atendimentos', (select count(*) from public.appointments a where a.status = 'concluido' and a.date > w.fim - 7 and a.date <= w.fim),
    'faturamento_cents', (select coalesce(sum(coalesce(a.price_cents, 0)), 0) from public.appointments a where a.status = 'concluido' and a.date > w.fim - 7 and a.date <= w.fim),
    'contas', (select count(*) from public.profiles p where p.created_at::date > w.fim - 7 and p.created_at::date <= w.fim),
    'vinculos', (select count(*) from public.vinculos v where v.criado_em::date > w.fim - 7 and v.criado_em::date <= w.fim),
    'whats', (select count(*) from public.message_outbox o where o.status in ('enviado','entregue','lido') and o.criado_em::date > w.fim - 7 and o.criado_em::date <= w.fim),
    'faltas', (select count(*) from public.appointments a where a.status = 'faltou' and a.date > w.fim - 7 and a.date <= w.fim)
  ) order by w.fim) end
  from w;
$$;

revoke execute on function public.plataforma_series(integer) from public, anon;
grant execute on function public.plataforma_series(integer) to authenticated;
