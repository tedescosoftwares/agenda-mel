-- =============================================================
-- Agenda Mel — 020: saber se o mês fechou no azul
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 019).
--
-- Números que a profissional hoje só tem "de cabeça": quanto
-- entrou, quanto vale um atendimento em média, quantas faltaram,
-- quanto da agenda ficou parada e quem voltou.
--
-- Dinheiro sempre em centavos inteiros; percentual em pontos-base
-- (1234 = 12,34%) — nada de float em cima de dinheiro.
-- =============================================================

-- 1. Quanto tempo a agenda tinha para vender -----------------------------
-- Soma a janela de trabalho de cada dia do período e desconta almoço,
-- folga e compromisso. É o denominador da taxa de ocupação.
create or replace function public.minutos_disponiveis(
  prof uuid,
  de date,
  ate date
)
returns integer
language sql
stable
security definer set search_path = public
as $$
  with dias as (
    select d::date as dia
    from generate_series(de, ate, interval '1 day') d
  ),
  janelas as (
    select dias.dia,
           h.start_time,
           h.end_time,
           extract(epoch from (h.end_time - h.start_time)) / 60 as minutos
    from dias
    join public.professional_hours h
      on h.professional_id = prof
     and h.weekday = extract(dow from dias.dia)::smallint
    where h.open
  ),
  descontos as (
    select j.dia,
           sum(
             case
               when b.all_day then j.minutos
               else greatest(
                 0,
                 extract(epoch from (
                   least(b.end_time, j.end_time) - greatest(b.start_time, j.start_time)
                 )) / 60
               )
             end
           ) as minutos
    from janelas j
    join public.professional_blocks b
      on b.professional_id = prof
     and (
       (b.kind = 'semanal' and b.weekday = extract(dow from j.dia)::smallint)
       or (b.kind = 'data' and b.date = j.dia)
     )
    group by j.dia
  )
  select greatest(
    0,
    coalesce(
      (select sum(j.minutos) from janelas j)
      - (select coalesce(sum(d.minutos), 0) from descontos d),
      0
    )
  )::integer;
$$;

revoke execute on function public.minutos_disponiveis(uuid, date, date)
  from public, anon, authenticated;

-- 2. O mês em números ----------------------------------------------------
create or replace function public.resumo_do_mes(
  prof uuid default public.my_professional_id(),
  mes date default null
)
returns table (
  inicio date,
  fim date,
  atendimentos integer,
  faturamento_cents bigint,
  ticket_medio_cents integer,
  descontos_cents bigint,
  faltas integer,
  cancelamentos integer,
  taxa_falta_bps integer,
  clientes integer,
  clientes_novas integer,
  encaixes integer,
  minutos_ocupados integer,
  minutos_disponiveis integer,
  ocupacao_bps integer,
  faturamento_mes_anterior_cents bigint
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  hoje date := public.agora_local()::date;
  ini date;
  fin date;
  ate date;
  ini_ant date;
  fim_ant date;
  concluidos integer;
  faltou integer;
begin
  if prof is null then
    raise exception 'Informe a profissional';
  end if;

  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;

  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, hoje))::date;
  fin := (ini + interval '1 month - 1 day')::date;
  -- no mês corrente a agenda ainda não aconteceu inteira
  ate := least(fin, hoje);
  ini_ant := (ini - interval '1 month')::date;
  fim_ant := (ini - interval '1 day')::date;

  select count(*) filter (where a.status = 'concluido'),
         count(*) filter (where a.status = 'faltou')
    into concluidos, faltou
  from public.appointments a
  where a.professional_id = prof and a.date between ini and fin;

  return query
  select
    ini,
    fin,
    concluidos,
    coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)::bigint,
    case when concluidos > 0
      then (coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)
            / concluidos)::integer
      else 0 end,
    coalesce((
      select -sum(ct.amount_cents)
      from public.credit_transactions ct
      join public.appointments ap on ap.id = ct.appointment_id
      where ct.kind = 'uso'
        and ap.professional_id = prof
        and ap.date between ini and fin
    ), 0)::bigint,
    faltou,
    count(*) filter (where a.status = 'cancelado')::integer,
    case when (concluidos + faltou) > 0
      then ((faltou::numeric * 10000) / (concluidos + faltou))::integer
      else 0 end,
    count(distinct a.client_id) filter (where a.status = 'concluido')::integer,
    count(distinct a.client_id) filter (
      where a.status = 'concluido'
        and not exists (
          select 1 from public.appointments ant
          where ant.professional_id = prof
            and ant.client_id = a.client_id
            and ant.status = 'concluido'
            and ant.date < ini
        )
    )::integer,
    count(*) filter (where a.status = 'concluido' and a.client_id is null)::integer,
    coalesce(sum(
      extract(epoch from (a.end_time - a.start_time)) / 60
    ) filter (where a.status = 'concluido'), 0)::integer,
    public.minutos_disponiveis(prof, ini, ate),
    case when public.minutos_disponiveis(prof, ini, ate) > 0
      then least(10000, ((coalesce(sum(
             extract(epoch from (a.end_time - a.start_time)) / 60
           ) filter (where a.status = 'concluido'), 0) * 10000)
           / public.minutos_disponiveis(prof, ini, ate))::integer)
      else 0 end,
    coalesce((
      select sum(ant.price_cents)
      from public.appointments ant
      where ant.professional_id = prof
        and ant.status = 'concluido'
        and ant.date between ini_ant and fim_ant
    ), 0)::bigint
  from public.appointments a
  where a.professional_id = prof and a.date between ini and fin;
end;
$$;

revoke execute on function public.resumo_do_mes(uuid, date) from public, anon;
grant execute on function public.resumo_do_mes(uuid, date) to authenticated;

-- 3. O que mais rendeu ---------------------------------------------------
create or replace function public.faturamento_por_servico(
  prof uuid default public.my_professional_id(),
  mes date default null
)
returns table (
  servico text,
  quantidade integer,
  total_cents bigint,
  fatia_bps integer
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  ini date;
  fin date;
  total bigint;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, public.agora_local()::date))::date;
  fin := (ini + interval '1 month - 1 day')::date;

  select coalesce(sum(a.price_cents), 0) into total
  from public.appointments a
  where a.professional_id = prof and a.status = 'concluido'
    and a.date between ini and fin;

  return query
  select coalesce(a.service_name, s.name, 'Sem nome'),
         count(*)::integer,
         coalesce(sum(a.price_cents), 0)::bigint,
         case when total > 0
           then ((coalesce(sum(a.price_cents), 0)::numeric * 10000) / total)::integer
           else 0 end
  from public.appointments a
  left join public.services s on s.id = a.service_id
  where a.professional_id = prof and a.status = 'concluido'
    and a.date between ini and fin
  group by coalesce(a.service_name, s.name, 'Sem nome')
  order by 3 desc;
end;
$$;

revoke execute on function public.faturamento_por_servico(uuid, date) from public, anon;
grant execute on function public.faturamento_por_servico(uuid, date) to authenticated;

-- 4. Quem mais volta -----------------------------------------------------
create or replace function public.melhores_clientes(
  prof uuid default public.my_professional_id(),
  meses integer default 6,
  limite integer default 10
)
returns table (
  client_id uuid,
  nome text,
  visitas integer,
  total_cents bigint,
  ultima_visita date
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  desde date;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  desde := (public.agora_local()::date
            - make_interval(months => greatest(1, least(coalesce(meses, 6), 36))))::date;

  return query
  select a.client_id,
         coalesce(c.full_name, 'Cliente'),
         count(*)::integer,
         coalesce(sum(a.price_cents), 0)::bigint,
         max(a.date)
  from public.appointments a
  join public.profiles c on c.id = a.client_id
  where a.professional_id = prof and a.status = 'concluido' and a.date >= desde
  group by a.client_id, c.full_name
  order by 3 desc, 4 desc
  limit greatest(1, least(coalesce(limite, 10), 50));
end;
$$;

revoke execute on function public.melhores_clientes(uuid, integer, integer) from public, anon;
grant execute on function public.melhores_clientes(uuid, integer, integer) to authenticated;

-- 5. O salão inteiro, uma linha por profissional -------------------------
create or replace function public.resumo_do_salao(
  salao uuid default null,
  mes date default null
)
returns table (
  professional_id uuid,
  nome text,
  atendimentos integer,
  faturamento_cents bigint,
  faltas integer,
  ocupacao_bps integer
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  alvo uuid;
  ini date;
  fin date;
  ate date;
  hoje date := public.agora_local()::date;
begin
  -- meus_saloes() devolve os uuid direto, sem nome de coluna
  alvo := coalesce(salao, (select s from public.meus_saloes() s limit 1));
  if alvo is null then
    raise exception 'Informe o salão';
  end if;
  if not public.is_admin_do_salao(alvo) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, hoje))::date;
  fin := (ini + interval '1 month - 1 day')::date;
  ate := least(fin, hoje);

  return query
  select p.id,
         p.name,
         count(*) filter (where a.status = 'concluido')::integer,
         coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)::bigint,
         count(*) filter (where a.status = 'faltou')::integer,
         case when public.minutos_disponiveis(p.id, ini, ate) > 0
           then least(10000, ((coalesce(sum(
                  extract(epoch from (a.end_time - a.start_time)) / 60
                ) filter (where a.status = 'concluido'), 0) * 10000)
                / public.minutos_disponiveis(p.id, ini, ate))::integer)
           else 0 end
  from public.professionals p
  left join public.appointments a
    on a.professional_id = p.id and a.date between ini and fin
  where p.salon_id = alvo
  group by p.id, p.name
  order by 4 desc;
end;
$$;

revoke execute on function public.resumo_do_salao(uuid, date) from public, anon;
grant execute on function public.resumo_do_salao(uuid, date) to authenticated;
