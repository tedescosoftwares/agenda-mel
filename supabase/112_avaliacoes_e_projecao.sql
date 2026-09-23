-- 112: dois relatórios pra casa. As avaliações num período (média, volume,
-- por profissional, por serviço, comentários) e a projeção da semana:
-- uma ESTIMATIVA a partir do que está marcado, separando o que já entrou
-- (sinal pelo app, comandas fechadas) do que ainda depende de a cliente vir.

-- 1. Avaliações do período ------------------------------------------------------
create or replace function public.avaliacoes_do_periodo(salao uuid, de date, ate date)
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
    if minha is null then raise exception 'Só a casa ou a própria profissional vê as avaliações.'; end if;
  end if;
  if ate < de then raise exception 'O período está invertido.'; end if;
  if ate - de > 366 then raise exception 'Escolha um período de até um ano.'; end if;

  with av as (
    select rv.id, rv.nota, nullif(btrim(coalesce(rv.comentario, '')), '') comentario, rv.created_at em,
           a.id appointment_id, a.date dia, a.professional_id, p.name profissional,
           coalesce(a.service_name, sv.name, 'Atendimento') servico,
           coalesce(nullif(btrim(pf.full_name), ''), 'Cliente') cliente
    from public.reviews rv
    join public.appointments a on a.id = rv.appointment_id
    left join public.professionals p on p.id = a.professional_id
    left join public.services sv on sv.id = a.service_id
    left join public.profiles pf on pf.id = rv.client_id
    where a.salon_id = salao and (rv.created_at at time zone 'America/Sao_Paulo')::date between de and ate
      and (minha is null or a.professional_id = minha)
  ),
  feitos as (
    select count(*) n from public.appointments x where x.salon_id = salao and x.status = 'concluido' and x.date between de and ate and (minha is null or x.professional_id = minha)
  )
  select jsonb_build_object(
    'de', de, 'ate', ate,
    'total', (select jsonb_build_object(
        'quantas', count(*), 'media', round(avg(nota)::numeric, 2), 'com_comentario', count(*) filter (where comentario is not null),
        'atendimentos', (select n from feitos),
        'distribuicao', jsonb_build_object('1', count(*) filter (where nota = 1), '2', count(*) filter (where nota = 2), '3', count(*) filter (where nota = 3), '4', count(*) filter (where nota = 4), '5', count(*) filter (where nota = 5))
      ) from av),
    'por_profissional', (select coalesce(jsonb_agg(jsonb_build_object(
        'professional_id', g.professional_id, 'nome', coalesce(g.profissional, 'Sem profissional'), 'quantas', g.n, 'media', g.media, 'cinco', g.cinco, 'baixas', g.baixas,
        'atendimentos', (select count(*) from public.appointments x where x.salon_id = salao and x.status = 'concluido' and x.date between de and ate and x.professional_id is not distinct from g.professional_id)
      ) order by g.media desc, g.n desc), '[]'::jsonb)
      from (select professional_id, profissional, count(*) n, round(avg(nota)::numeric, 2) media, count(*) filter (where nota = 5) cinco, count(*) filter (where nota <= 3) baixas from av group by 1, 2) g),
    'por_servico', (select coalesce(jsonb_agg(jsonb_build_object('servico', g.servico, 'quantas', g.n, 'media', g.media) order by g.media desc, g.n desc), '[]'::jsonb)
      from (select servico, count(*) n, round(avg(nota)::numeric, 2) media from av group by 1) g),
    'lista', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'em', em, 'dia', dia, 'appointment_id', appointment_id, 'cliente', cliente, 'professional_id', professional_id, 'profissional', profissional,
        'servico', servico, 'nota', nota, 'comentario', comentario) order by em desc), '[]'::jsonb) from av)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.avaliacoes_do_periodo(uuid, date, date) from public, anon;
grant execute on function public.avaliacoes_do_periodo(uuid, date, date) to authenticated;

-- 2. Projeção da semana ------------------------------------------------------------
-- previsto = o que está marcado (confirmado + pendente) mais o que já foi
-- feito; realizado = o que fechou (comanda, ou o valor do horário concluído
-- sem comanda); sinal = o que a cliente já pagou pelo app e está no caixa.
create or replace function public.projecao_semanal(salao uuid, inicio date default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare r jsonb; minha uuid; dona boolean; d0 date; d1 date;
begin
  dona := public.is_admin_do_salao(salao) or public.eh_plataforma();
  if not dona then
    select p.id into minha from public.professionals p where p.salon_id = salao and p.user_id = auth.uid() limit 1;
    if minha is null then raise exception 'Só a casa ou a própria profissional vê a projeção.'; end if;
  end if;
  d0 := coalesce(inicio, public.agora_local()::date);
  d0 := d0 - ((extract(isodow from d0)::integer) - 1);   -- segunda-feira
  d1 := d0 + 6;

  with h as (
    select a.id, a.date, a.status, a.professional_id, p.name profissional, coalesce(a.price_cents, 0) preco, coalesce(a.pago_cents, 0) sinal,
           (select coalesce(sum(ci.liquido_cents), 0) from public.comanda_itens ci where ci.appointment_id = a.id and ci.status = 'fechada') fechado
    from public.appointments a
    left join public.professionals p on p.id = a.professional_id
    where a.salon_id = salao and a.date between d0 and d1 and a.status <> 'cancelado'
      and (minha is null or a.professional_id = minha)
  ),
  v as (
    select *,
      case when status = 'concluido' then (case when fechado > 0 then fechado else preco end) else 0 end realizado,
      case when status in ('confirmado', 'pendente') then preco else 0 end a_vir,
      case when status = 'faltou' then preco else 0 end perdido
    from h
  ),
  dias as (select generate_series(d0, d1, interval '1 day')::date dia)
  select jsonb_build_object(
    'inicio', d0, 'fim', d1, 'hoje', public.agora_local()::date,
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
        'perdido_cents', (select coalesce(sum(perdido), 0) from v where v.date = ds.dia)
      ) order by ds.dia) from dias ds),
    'total', (select jsonb_build_object(
        'horarios', count(*) filter (where status <> 'faltou'), 'confirmados', count(*) filter (where status = 'confirmado'), 'pendentes', count(*) filter (where status = 'pendente'),
        'concluidos', count(*) filter (where status = 'concluido'), 'faltas', count(*) filter (where status = 'faltou'),
        'previsto_cents', coalesce(sum(realizado + a_vir), 0),
        'confirmado_cents', coalesce(sum(preco) filter (where status = 'confirmado'), 0),
        'pendente_cents', coalesce(sum(preco) filter (where status = 'pendente'), 0),
        'realizado_cents', coalesce(sum(realizado), 0),
        'sinal_cents', coalesce(sum(sinal) filter (where status in ('confirmado', 'pendente')), 0),
        'perdido_cents', coalesce(sum(perdido), 0)
      ) from v),
    'por_profissional', (select coalesce(jsonb_agg(jsonb_build_object(
        'professional_id', g.professional_id, 'nome', coalesce(g.profissional, 'Sem profissional'), 'horarios', g.n, 'pendentes', g.pend,
        'previsto_cents', g.previsto, 'realizado_cents', g.realizado, 'sinal_cents', g.sinal
      ) order by g.previsto desc), '[]'::jsonb)
      from (select professional_id, profissional, count(*) filter (where status <> 'faltou') n, count(*) filter (where status = 'pendente') pend,
                   sum(realizado + a_vir) previsto, sum(realizado) realizado, sum(sinal) filter (where status in ('confirmado', 'pendente')) sinal
            from v group by 1, 2) g),
    'semana_passada', (select jsonb_build_object(
        'realizado_cents', coalesce(sum(case when x.status = 'concluido' then (case when f.v > 0 then f.v else coalesce(x.price_cents, 0) end) else 0 end), 0),
        'horarios', count(*) filter (where x.status = 'concluido'))
      from public.appointments x
      left join lateral (select coalesce(sum(ci.liquido_cents), 0) v from public.comanda_itens ci where ci.appointment_id = x.id and ci.status = 'fechada') f on true
      where x.salon_id = salao and x.date between d0 - 7 and d1 - 7 and (minha is null or x.professional_id = minha))
  ) into r;
  return r;
end;
$$;
revoke execute on function public.projecao_semanal(uuid, date) from public, anon;
grant execute on function public.projecao_semanal(uuid, date) to authenticated;
