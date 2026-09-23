-- 113: a cota é regra da casa. Sem contrato de parceria, vale a cota
-- padrão do salão (50% do líquido, por padrão); o contrato só sobrescreve.
-- E a projeção da semana fica mais completa: parte da casa e da equipe pela
-- cota, ocupação da agenda, ticket médio, as últimas semanas para comparar,
-- e filtro por profissional.

-- 1. A cota padrão da casa ------------------------------------------------------
alter table public.salons add column if not exists cota_padrao_pct numeric(5,2) not null default 50;
alter table public.salons add column if not exists base_padrao text not null default 'liquido';
do $$ begin
  alter table public.salons add constraint salons_cota_padrao_razoavel check (cota_padrao_pct >= 0 and cota_padrao_pct <= 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.salons add constraint salons_base_padrao_conhecida check (base_padrao in ('bruto', 'liquido'));
exception when duplicate_object then null; end $$;

create or replace function public.salao_cota_padrao(salao uuid, pct numeric, base text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão muda isso.'; end if;
  if pct < 0 or pct > 100 then raise exception 'A cota vai de 0 a 100%%.'; end if;
  if base is not null and base not in ('bruto', 'liquido') then raise exception 'Base desconhecida.'; end if;
  update public.salons set cota_padrao_pct = pct, base_padrao = coalesce(base, base_padrao) where id = salao;
  select * into s from public.salons where id = salao;
  return jsonb_build_object('cota_pct', s.cota_padrao_pct, 'base', s.base_padrao);
end;
$$;
revoke execute on function public.salao_cota_padrao(uuid, numeric, text) from public, anon;
grant execute on function public.salao_cota_padrao(uuid, numeric, text) to authenticated;

-- 2. Repasse: contrato ou padrão da casa, nunca 'sem cota' ---------------------
create or replace function public.pdv_repasse(salao uuid, de date, ate date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare r jsonb; minha uuid; dona boolean;
begin
  dona := public.is_admin_do_salao(salao) or public.eh_plataforma();
  if not dona then
    select p.id into minha from public.professionals p where p.salon_id = salao and p.user_id = auth.uid() limit 1;
    if minha is null then raise exception 'Só a casa ou a própria profissional vê o repasse.'; end if;
  end if;
  if ate < de then raise exception 'O período está invertido.'; end if;
  if ate - de > 92 then raise exception 'Escolha um período de até 3 meses.'; end if;

  with itens as (
    select ci.*, coalesce(nullif(btrim(pf.full_name), ''), c.cliente_nome, 'Cliente') cliente, p.name profissional, c.fechada_em,
           pa.id parceria_id, coalesce(pa.cota_pct, s.cota_padrao_pct) cota_pct, coalesce(pa.base_calculo, s.base_padrao) base_calculo, pa.periodicidade,
           case when pa.id is null then s.cota_padrao_pct else public.cota_do_item(pa, ci.nome) end cota,
           round((case when coalesce(pa.base_calculo, s.base_padrao) = 'liquido' then ci.liquido_cents else ci.valor_cents end)
                 * (case when pa.id is null then s.cota_padrao_pct else public.cota_do_item(pa, ci.nome) end) / 100.0)::integer repasse_cents
    from public.comanda_itens ci
    join public.comandas c on c.id = ci.comanda_id
    join public.salons s on s.id = salao
    left join public.profiles pf on pf.id = c.client_id
    left join public.professionals p on p.id = ci.professional_id
    left join lateral (select * from public.parcerias x where x.salon_id = salao and x.professional_id = ci.professional_id and x.status = 'vigente' and x.inicio <= ci.dia order by x.inicio desc limit 1) pa on true
    where ci.salon_id = salao and ci.status = 'fechada' and ci.dia between de and ate
      and (minha is null or ci.professional_id = minha)
  )
  select jsonb_build_object(
    'de', de, 'ate', ate,
    'padrao', (select jsonb_build_object('cota_pct', s2.cota_padrao_pct, 'base', s2.base_padrao) from public.salons s2 where s2.id = salao),
    'total', (select jsonb_build_object('bruto_cents', coalesce(sum(valor_cents), 0), 'desconto_cents', coalesce(sum(desconto_cents), 0), 'liquido_cents', coalesce(sum(liquido_cents), 0),
                                        'repasse_cents', coalesce(sum(repasse_cents), 0), 'comandas', count(distinct comanda_id), 'itens', count(*)) from itens),
    'por_profissional', (select coalesce(jsonb_agg(jsonb_build_object(
        'professional_id', g.professional_id, 'nome', coalesce(g.profissional, 'Sem profissional'), 'comandas', g.comandas, 'itens', g.n,
        'bruto_cents', g.bruto, 'desconto_cents', g.desc_, 'liquido_cents', g.liq,
        'contrato', jsonb_build_object('origem', case when g.parceria_id is null then 'casa' else 'contrato' end, 'parceria_id', g.parceria_id, 'cota_pct', g.cota_pct, 'base_calculo', g.base_calculo, 'periodicidade', g.periodicidade),
        'repasse_cents', g.repasse, 'casa_cents', g.liq - g.repasse
      ) order by g.liq desc), '[]'::jsonb)
      from (select professional_id, profissional, count(distinct comanda_id) comandas, count(*) n, sum(valor_cents) bruto, sum(desconto_cents) desc_, sum(liquido_cents) liq,
                   max(parceria_id::text)::uuid parceria_id, max(cota_pct) cota_pct, max(base_calculo) base_calculo, max(periodicidade) periodicidade, sum(repasse_cents) repasse
            from itens group by professional_id, profissional) g),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'dia', i.dia, 'fechada_em', i.fechada_em, 'comanda_id', i.comanda_id, 'appointment_id', i.appointment_id, 'cliente', i.cliente,
        'professional_id', i.professional_id, 'profissional', i.profissional, 'nome', i.nome, 'qtd', i.qtd,
        'valor_cents', i.valor_cents, 'desconto_cents', i.desconto_cents, 'liquido_cents', i.liquido_cents, 'cota_pct', i.cota, 'repasse_cents', i.repasse_cents
      ) order by i.fechada_em desc, i.ordem), '[]'::jsonb) from itens i)
  ) into r;
  return r;
end;
$$;

-- 3. Projeção da semana, versão 2 ----------------------------------------------
-- os números de uma semana (pra comparar as últimas)
create or replace function public.semana_numeros(salao uuid, d0 date, filtro uuid default null)
returns table (previsto_cents bigint, realizado_cents bigint, horarios bigint)
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(case when a.status = 'concluido' then (case when f.v > 0 then f.v else coalesce(a.price_cents, 0) end) when a.status in ('confirmado', 'pendente') then coalesce(a.price_cents, 0) else 0 end), 0),
         coalesce(sum(case when a.status = 'concluido' then (case when f.v > 0 then f.v else coalesce(a.price_cents, 0) end) else 0 end), 0),
         count(*) filter (where a.status in ('confirmado', 'pendente', 'concluido'))
  from public.appointments a
  left join lateral (select coalesce(sum(ci.liquido_cents), 0) v from public.comanda_itens ci where ci.appointment_id = a.id and ci.status = 'fechada') f on true
  where a.salon_id = salao and a.date between d0 and d0 + 6 and a.status <> 'cancelado' and (filtro is null or a.professional_id = filtro);
$$;
revoke execute on function public.semana_numeros(uuid, date, uuid) from public, anon, authenticated;

drop function if exists public.projecao_semanal(uuid, date);
create or replace function public.projecao_semanal(salao uuid, inicio date default null, prof uuid default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare r jsonb; minha uuid; dona boolean; d0 date; d1 date; filtro uuid;
begin
  dona := public.is_admin_do_salao(salao) or public.eh_plataforma();
  if not dona then
    select p.id into minha from public.professionals p where p.salon_id = salao and p.user_id = auth.uid() limit 1;
    if minha is null then raise exception 'Só a casa ou a própria profissional vê a projeção.'; end if;
  end if;
  filtro := coalesce(minha, prof);
  d0 := coalesce(inicio, public.agora_local()::date);
  d0 := d0 - ((extract(isodow from d0)::integer) - 1);   -- segunda-feira
  d1 := d0 + 6;

  with s as (select * from public.salons where id = salao),
  h as (
    select a.id, a.date, a.status, a.professional_id, p.name profissional, coalesce(a.price_cents, 0) preco, coalesce(a.pago_cents, 0) sinal,
           greatest(0, extract(epoch from (a.end_time - a.start_time)) / 60)::integer minutos,
           (select coalesce(sum(ci.liquido_cents), 0) from public.comanda_itens ci where ci.appointment_id = a.id and ci.status = 'fechada') fechado,
           coalesce(pa.cota_pct, (select cota_padrao_pct from s)) cota, pa.id parceria_id
    from public.appointments a
    left join public.professionals p on p.id = a.professional_id
    left join lateral (select * from public.parcerias x where x.salon_id = salao and x.professional_id = a.professional_id and x.status = 'vigente' and x.inicio <= a.date order by x.inicio desc limit 1) pa on true
    where a.salon_id = salao and a.date between d0 and d1 and a.status <> 'cancelado'
      and (filtro is null or a.professional_id = filtro)
  ),
  v as (
    select *,
      case when status = 'concluido' then (case when fechado > 0 then fechado else preco end) else 0 end realizado,
      case when status in ('confirmado', 'pendente') then preco else 0 end a_vir,
      case when status = 'faltou' then preco else 0 end perdido,
      case when status in ('confirmado', 'pendente', 'concluido') then minutos else 0 end marcados
    from h
  ),
  dias as (select generate_series(d0, d1, interval '1 day')::date dia),
  -- expediente aberto por profissional e dia: o dela, senão o do salão
  exp as (
    select p.id professional_id, ds.dia,
      case when ph.professional_id is not null then (case when ph.open then extract(epoch from (ph.end_time - ph.start_time)) / 60 else 0 end)
           when bh.salon_id is not null then (case when bh.open then extract(epoch from (bh.end_time - bh.start_time)) / 60 else 0 end)
           else 0 end::integer abertos
    from public.professionals p
    cross join dias ds
    left join public.professional_hours ph on ph.professional_id = p.id and ph.weekday = extract(dow from ds.dia)::integer
    left join public.business_hours bh on bh.salon_id = salao and bh.weekday = extract(dow from ds.dia)::integer
    where p.salon_id = salao and p.active and (filtro is null or p.id = filtro)
  )
  select jsonb_build_object(
    'inicio', d0, 'fim', d1, 'hoje', public.agora_local()::date, 'filtro', filtro,
    'padrao', (select jsonb_build_object('cota_pct', cota_padrao_pct, 'base', base_padrao) from s),
    'dias', (select jsonb_agg(jsonb_build_object(
        'dia', ds.dia,
        'horarios', (select count(*) from v where v.date = ds.dia and v.status <> 'faltou'),
        'confirmados', (select count(*) from v where v.date = ds.dia and v.status = 'confirmado'),
        'pendentes', (select count(*) from v where v.date = ds.dia and v.status = 'pendente'),
        'concluidos', (select count(*) from v where v.date = ds.dia and v.status = 'concluido'),
        'faltas', (select count(*) from v where v.date = ds.dia and v.status = 'faltou'),
        'previsto_cents', (select coalesce(sum(realizado + a_vir), 0) from v where v.date = ds.dia),
        'confirmado_cents', (select coalesce(sum(preco), 0) from v where v.date = ds.dia and v.status = 'confirmado'),
        'pendente_cents', (select coalesce(sum(preco), 0) from v where v.date = ds.dia and v.status = 'pendente'),
        'realizado_cents', (select coalesce(sum(realizado), 0) from v where v.date = ds.dia),
        'sinal_cents', (select coalesce(sum(sinal), 0) from v where v.date = ds.dia and v.status in ('confirmado', 'pendente')),
        'perdido_cents', (select coalesce(sum(perdido), 0) from v where v.date = ds.dia),
        'minutos_marcados', (select coalesce(sum(marcados), 0) from v where v.date = ds.dia),
        'minutos_abertos', (select coalesce(sum(abertos), 0) from exp where exp.dia = ds.dia)
      ) order by ds.dia) from dias ds),
    'total', (select jsonb_build_object(
        'horarios', count(*) filter (where status <> 'faltou'), 'confirmados', count(*) filter (where status = 'confirmado'), 'pendentes', count(*) filter (where status = 'pendente'),
        'concluidos', count(*) filter (where status = 'concluido'), 'faltas', count(*) filter (where status = 'faltou'),
        'previsto_cents', coalesce(sum(realizado + a_vir), 0),
        'confirmado_cents', coalesce(sum(preco) filter (where status = 'confirmado'), 0),
        'pendente_cents', coalesce(sum(preco) filter (where status = 'pendente'), 0),
        'realizado_cents', coalesce(sum(realizado), 0),
        'sinal_cents', coalesce(sum(sinal) filter (where status in ('confirmado', 'pendente')), 0),
        'perdido_cents', coalesce(sum(perdido), 0),
        'equipe_cents', coalesce(sum(round((realizado + a_vir) * cota / 100.0)), 0),
        'casa_cents', coalesce(sum(realizado + a_vir) - sum(round((realizado + a_vir) * cota / 100.0)), 0),
        'ticket_medio_cents', case when count(*) filter (where status in ('confirmado', 'pendente', 'concluido')) > 0 then round(sum(realizado + a_vir) / count(*) filter (where status in ('confirmado', 'pendente', 'concluido'))) else 0 end,
        'minutos_marcados', coalesce(sum(marcados), 0),
        'minutos_abertos', (select coalesce(sum(abertos), 0) from exp)
      ) from v),
    'por_profissional', (select coalesce(jsonb_agg(jsonb_build_object(
        'professional_id', g.professional_id, 'nome', coalesce(g.profissional, 'Sem profissional'), 'horarios', g.n, 'pendentes', g.pend,
        'previsto_cents', g.previsto, 'realizado_cents', g.realizado, 'sinal_cents', g.sinal,
        'cota_pct', g.cota, 'contrato', g.contrato, 'equipe_cents', g.equipe, 'casa_cents', g.previsto - g.equipe,
        'minutos_marcados', g.marcados, 'minutos_abertos', (select coalesce(sum(abertos), 0) from exp where exp.professional_id = g.professional_id)
      ) order by g.previsto desc), '[]'::jsonb)
      from (select professional_id, profissional, count(*) filter (where status <> 'faltou') n, count(*) filter (where status = 'pendente') pend,
                   sum(realizado + a_vir) previsto, sum(realizado) realizado, coalesce(sum(sinal) filter (where status in ('confirmado', 'pendente')), 0) sinal,
                   max(cota) cota, bool_or(parceria_id is not null) contrato, sum(round((realizado + a_vir) * cota / 100.0)) equipe, sum(marcados) marcados
            from v group by 1, 2) g),
    'semanas', (select jsonb_agg(jsonb_build_object('inicio', w.ini, 'previsto_cents', n.previsto_cents, 'realizado_cents', n.realizado_cents, 'horarios', n.horarios) order by w.ini)
      from (select d0 - 7 * k ini from generate_series(4, 0, -1) k) w
      cross join lateral public.semana_numeros(salao, w.ini, filtro) n),
    'semana_passada', (select jsonb_build_object('realizado_cents', n.realizado_cents, 'horarios', n.horarios) from public.semana_numeros(salao, d0 - 7, filtro) n)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.projecao_semanal(uuid, date, uuid) from public, anon;
grant execute on function public.projecao_semanal(uuid, date, uuid) to authenticated;
